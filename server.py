"""
Presentation Server with WebSocket Streaming, Chat, TTS, and STT

Features:
- WebSocket streaming for presentation content
- Chat with PDF context using Groq
- OpenAI TTS for voice output
- OpenAI Whisper STT for voice input
- Pause/Resume/Interrupt handling
"""

import os
import re
import json
import asyncio
import base64
from typing import Dict, List, Optional
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, UploadFile, File
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn

from groq import Groq
from openai import OpenAI
from deepgram import DeepgramClient
from dotenv import load_dotenv

load_dotenv()

# Import database module
import database as db

app = FastAPI(title="PDF Presentation System")

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize clients
groq_client = Groq(api_key=os.getenv("GROQ_API_KEY"))
openai_client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
deepgram_client = DeepgramClient(api_key=os.getenv("DEEPGRAM_API_KEY"))

# Deepgram voice models mapping
DEEPGRAM_VOICES = {
    "asteria": "aura-asteria-en",      # Female, American, warm and conversational
    "luna": "aura-luna-en",            # Female, American, soft and gentle
    "stella": "aura-stella-en",        # Female, American, confident and clear
    "athena": "aura-athena-en",        # Female, British, professional
    "hera": "aura-hera-en",            # Female, American, authoritative
    "orion": "aura-orion-en",          # Male, American, deep and confident
    "arcas": "aura-arcas-en",          # Male, American, youthful and energetic
    "perseus": "aura-perseus-en",      # Male, American, warm and friendly
    "angus": "aura-angus-en",          # Male, Irish accent
    "orpheus": "aura-orpheus-en",      # Male, American, calm and soothing
    "helios": "aura-helios-en",        # Male, British, refined
    "zeus": "aura-zeus-en",            # Male, American, powerful and commanding
}

# Global state
class PresentationState:
    def __init__(self):
        self.is_playing = False
        self.is_paused = False
        self.current_section = 0
        self.presentation_data = None
        self.analysis_data = None
        self.chat_history = []
        self.interrupt_flag = False

    def reset(self):
        self.is_playing = False
        self.is_paused = False
        self.current_section = 0
        self.interrupt_flag = False

state = PresentationState()

# ============================================================================
# Data Models
# ============================================================================
class ChatMessage(BaseModel):
    message: str
    user_id: Optional[int] = None

class TTSRequest(BaseModel):
    text: str
    voice: str = "asteria"

# ============================================================================
# Load Data
# ============================================================================
def load_presentation(path: str = "output/presentation.json") -> Dict:
    """Load presentation JSON"""
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    return None

def load_analysis(path: str = "output/analysis_results.json") -> List[Dict]:
    """Load analysis JSON for chat context"""
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    return None

# ============================================================================
# Chat with PDF Context
# ============================================================================
def build_pdf_context(analysis_data: List[Dict]) -> str:
    """Build context string from analysis data"""
    if not analysis_data:
        return "No PDF data available."

    context_parts = []
    for page in analysis_data:
        page_num = page['page_num'] + 1
        summary = page['page_summary']
        key_points = "\n".join(f"  - {kp}" for kp in page['key_points'])

        context_parts.append(f"""
PAGE {page_num}:
Summary: {summary}
Key Points:
{key_points}
""")

    return "\n".join(context_parts)

def find_relevant_pages(question: str, response: str, analysis_data: List[Dict]) -> List[Dict]:
    """Find pages relevant to the question/response by keyword matching"""
    references = []
    if not analysis_data:
        return references

    # Combine question and response for keyword extraction
    combined_text = (question + " " + response).lower()

    # Extract meaningful keywords (remove common words)
    stop_words = {'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
                  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
                  'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare',
                  'ought', 'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by',
                  'from', 'as', 'into', 'through', 'during', 'before', 'after', 'above',
                  'below', 'between', 'under', 'again', 'further', 'then', 'once', 'here',
                  'there', 'when', 'where', 'why', 'how', 'all', 'each', 'few', 'more',
                  'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own',
                  'same', 'so', 'than', 'too', 'very', 'just', 'and', 'but', 'if', 'or',
                  'because', 'until', 'while', 'what', 'which', 'who', 'whom', 'this',
                  'that', 'these', 'those', 'am', 'it', 'its', 'they', 'them', 'their',
                  'i', 'me', 'my', 'we', 'our', 'you', 'your', 'he', 'him', 'his', 'she',
                  'her', 'about', 'also', 'available', 'include', 'including', 'options'}

    words = re.findall(r'\b[a-z]{3,}\b', combined_text)
    keywords = [w for w in words if w not in stop_words]

    # Score each page by keyword matches
    page_scores = []
    for page in analysis_data:
        page_num = page['page_num'] + 1
        page_text = (page.get('page_summary', '') + ' ' +
                    ' '.join(page.get('key_points', []))).lower()

        # Count keyword matches
        score = sum(1 for kw in keywords if kw in page_text)

        if score > 0:
            images = page.get('images', [])
            image_paths = []
            for img in images:
                # Handle both dict format and string format
                if isinstance(img, dict):
                    # Try saved_path first, then path
                    path = img.get('saved_path', '') or img.get('path', '')
                elif isinstance(img, str):
                    path = img
                else:
                    path = ''
                if path:
                    image_paths.append(path)

            if image_paths:
                page_scores.append({
                    'page': page_num,
                    'score': score,
                    'images': image_paths
                })

    # Sort by score and return top 2 most relevant pages (limit images per page)
    page_scores.sort(key=lambda x: x['score'], reverse=True)
    references = []
    for p in page_scores[:2]:  # Only top 2 pages
        references.append({
            'page': p['page'],
            'images': p['images'][:2]  # Max 2 images per page
        })

    return references

@app.post("/api/chat")
async def chat_with_pdf(request: ChatMessage):
    """Chat endpoint - answers questions about the PDF"""

    # Load analysis if not loaded
    if state.analysis_data is None:
        state.analysis_data = load_analysis()

    pdf_context = build_pdf_context(state.analysis_data)

    # Build messages with history
    messages = [
        {
            "role": "system",
            "content": f"""You are a helpful assistant answering questions about a PDF document.
Use the following document content to answer questions accurately.
If the answer is not in the document, say so clearly.

IMPORTANT FORMATTING RULES:
- Answer naturally and directly WITHOUT mentioning page numbers, sources, or "according to the document"
- Do NOT say things like "According to Page X" or "as mentioned on page X"
- Just provide the information as if you know it
- Use markdown formatting for readability:
  - Use **bold** for key terms
  - Use bullet points for lists
  - Keep responses concise

INTERNAL REFERENCE (for your tracking only - DO NOT mention these to user):
{pdf_context}
"""
        }
    ]

    # Add chat history (last 10 messages)
    for msg in state.chat_history[-10:]:
        messages.append(msg)

    # Add current message
    messages.append({"role": "user", "content": request.message})

    try:
        completion = groq_client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=messages,
            temperature=0.3,
            max_completion_tokens=1024
        )

        response = completion.choices[0].message.content

        # Find relevant pages and their images based on question/response content
        references = find_relevant_pages(request.message, response, state.analysis_data)

        # Update history
        state.chat_history.append({"role": "user", "content": request.message})
        state.chat_history.append({"role": "assistant", "content": response})

        # Log to database if user_id provided
        if request.user_id:
            db.save_chat_message(request.user_id, "user", request.message)
            db.save_chat_message(request.user_id, "assistant", response)
            db.update_user_activity(request.user_id)

        return {
            "response": response,
            "references": references,
            "status": "success"
        }

    except Exception as e:
        import traceback
        print("CHAT ERROR:")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

# ============================================================================
# LLM-based User Info Extraction
# ============================================================================
class ExtractInfoRequest(BaseModel):
    message: str
    field: str  # 'name', 'email', or 'phone'

@app.post("/api/extract-info")
async def extract_user_info(request: ExtractInfoRequest):
    """Use LLM to extract and validate user info from conversational input"""

    prompts = {
        'name': """Extract the person's name from this message. The user is responding to "What's your name?"

Rules:
- Extract ONLY the actual name, not greetings or filler words
- If they say "hi this is John" or "my name is John" or "I'm John", extract "John"
- Capitalize properly (e.g., "john doe" → "John Doe")
- If no valid name found, return empty string
- Names should only contain letters and spaces

Message: "{message}"

Respond in this exact JSON format only, no other text:
{{"extracted": "The Name Here", "valid": true, "error": ""}}

If invalid:
{{"extracted": "", "valid": false, "error": "Friendly error message"}}""",

        'email': """Extract the email address from this message. The user is responding to "What's your email?"

Rules:
- Extract ONLY the email address
- If they say "my email is test@gmail.com" or "it's test@gmail.com", extract "test@gmail.com"
- Validate it's a proper email format (has @ and domain)
- Convert to lowercase
- If no valid email found, return error

Message: "{message}"

Respond in this exact JSON format only, no other text:
{{"extracted": "email@example.com", "valid": true, "error": ""}}

If invalid:
{{"extracted": "", "valid": false, "error": "Friendly error message"}}""",

        'phone': """Extract the phone number from this message. The user is responding to "What's your phone number?"

Rules:
- Extract ONLY the digits (and optional + for country code)
- If they say "my number is 9876543210" or "it's +91 98765 43210", extract the digits
- Must have at least 10 digits
- Remove spaces, dashes, parentheses
- If no valid phone found, return error

Message: "{message}"

Respond in this exact JSON format only, no other text:
{{"extracted": "9876543210", "valid": true, "error": ""}}

If invalid:
{{"extracted": "", "valid": false, "error": "Friendly error message"}}"""
    }

    if request.field not in prompts:
        raise HTTPException(status_code=400, detail="Invalid field type")

    try:
        completion = groq_client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[
                {
                    "role": "system",
                    "content": "You are a data extraction assistant. Extract and validate user information. Respond ONLY with valid JSON, no other text."
                },
                {
                    "role": "user",
                    "content": prompts[request.field].format(message=request.message)
                }
            ],
            temperature=0.1,
            max_completion_tokens=150
        )

        response_text = completion.choices[0].message.content.strip()

        # Parse JSON response
        # Handle potential markdown code blocks
        if response_text.startswith("```"):
            response_text = response_text.split("```")[1]
            if response_text.startswith("json"):
                response_text = response_text[4:]
        response_text = response_text.strip()

        result = json.loads(response_text)
        return result

    except json.JSONDecodeError:
        return {"extracted": "", "valid": False, "error": "I couldn't understand that. Could you please try again?"}
    except Exception as e:
        print(f"Extract info error: {e}")
        return {"extracted": "", "valid": False, "error": "Something went wrong. Please try again."}

# ============================================================================
# Text-to-Speech (Deepgram)
# ============================================================================
@app.post("/api/tts")
async def text_to_speech(request: TTSRequest):
    """Convert text to speech using Deepgram TTS"""
    try:
        # Limit text length for faster response
        text = request.text
        if len(text) > 2000:
            text = text[:2000] + "..."

        # Get the Deepgram voice model from the voice name
        voice_model = DEEPGRAM_VOICES.get(request.voice, "aura-asteria-en")

        # Generate speech using Deepgram SDK
        audio_chunks = []
        for chunk in deepgram_client.speak.v1.audio.generate(
            text=text,
            model=voice_model
        ):
            audio_chunks.append(chunk)

        audio_bytes = b''.join(audio_chunks)

        # Return audio as base64
        audio_base64 = base64.b64encode(audio_bytes).decode('utf-8')

        return {"audio": audio_base64, "format": "mp3"}

    except Exception as e:
        print(f"TTS Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# ============================================================================
# Speech-to-Text (Deepgram)
# ============================================================================
@app.post("/api/stt")
async def speech_to_text(audio: UploadFile = File(...)):
    """Convert speech to text using Deepgram STT"""
    try:
        # Read audio file
        audio_bytes = await audio.read()

        # Transcribe using Deepgram SDK
        response = deepgram_client.listen.rest.v1.transcribe_file(
            {"buffer": audio_bytes, "mimetype": "audio/webm"},
            {"model": "nova-2", "smart_format": True, "language": "en", "punctuate": True}
        )

        # Extract transcript
        transcript = response.results.channels[0].alternatives[0].transcript

        return {"text": transcript, "status": "success"}

    except Exception as e:
        print(f"STT Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# ============================================================================
# Presentation Control
# ============================================================================
@app.get("/api/presentation/load")
async def load_presentation_data(product_id: Optional[int] = None):
    """Load presentation data - optionally for a specific product"""
    if product_id:
        product_folder = db.get_product_folder(product_id)
        presentation_path = product_folder / "presentation.json"
        analysis_path = product_folder / "analysis_results.json"

        if presentation_path.exists():
            with open(presentation_path, "r", encoding="utf-8") as f:
                state.presentation_data = json.load(f)
        else:
            state.presentation_data = None

        if analysis_path.exists():
            with open(analysis_path, "r", encoding="utf-8") as f:
                state.analysis_data = json.load(f)
        else:
            state.analysis_data = None
    else:
        state.presentation_data = load_presentation()
        state.analysis_data = load_analysis()

    if state.presentation_data:
        # Return full section data for TTS pre-generation
        sections = state.presentation_data.get("sections", [])
        section_data = []
        for i, section in enumerate(sections):
            section_data.append({
                "index": i,
                "title": section.get("title", ""),
                "content": section.get("content", ""),
                "images": section.get("images", []),
                "key_takeaways": section.get("key_takeaways", [])
            })

        return {
            "status": "success",
            "title": state.presentation_data.get("title", "Presentation"),
            "sections": len(sections),
            "section_data": section_data,  # Full section content for pre-generation
            "metadata": state.presentation_data.get("_metadata", {}),
            "product_id": product_id
        }
    return {"status": "error", "message": "No presentation found"}

@app.post("/api/presentation/pause")
async def pause_presentation():
    """Pause the presentation"""
    state.is_paused = True
    return {"status": "paused", "current_section": state.current_section}

@app.post("/api/presentation/resume")
async def resume_presentation():
    """Resume the presentation"""
    state.is_paused = False
    return {"status": "resumed", "current_section": state.current_section}

@app.post("/api/presentation/interrupt")
async def interrupt_presentation():
    """Interrupt for user query"""
    state.interrupt_flag = True
    state.is_paused = True
    return {"status": "interrupted"}

@app.post("/api/presentation/next")
async def next_section():
    """Skip to next section"""
    if state.presentation_data:
        max_sections = len(state.presentation_data.get("sections", []))
        if state.current_section < max_sections - 1:
            state.current_section += 1
    return {"current_section": state.current_section}

@app.post("/api/presentation/previous")
async def previous_section():
    """Go to previous section"""
    if state.current_section > 0:
        state.current_section -= 1
    return {"current_section": state.current_section}

@app.post("/api/presentation/goto/{section_id}")
async def goto_section(section_id: int):
    """Go to specific section"""
    if state.presentation_data:
        max_sections = len(state.presentation_data.get("sections", []))
        if 0 <= section_id < max_sections:
            state.current_section = section_id
    return {"current_section": state.current_section}

# ============================================================================
# WebSocket for Streaming Presentation
# ============================================================================
@app.websocket("/ws/presentation")
async def presentation_websocket(websocket: WebSocket):
    """WebSocket endpoint for streaming presentation"""
    await websocket.accept()

    try:
        # Load presentation if not loaded
        if state.presentation_data is None:
            state.presentation_data = load_presentation()

        if not state.presentation_data:
            await websocket.send_json({"type": "error", "message": "No presentation loaded"})
            return

        sections = state.presentation_data.get("sections", [])
        state.is_playing = True
        state.is_paused = False
        state.current_section = 0

        await websocket.send_json({
            "type": "start",
            "title": state.presentation_data.get("title", "Presentation"),
            "total_sections": len(sections)
        })

        while state.current_section < len(sections):
            # Check for pause
            while state.is_paused:
                await websocket.send_json({"type": "status", "status": "paused"})
                await asyncio.sleep(0.5)

                # Check for incoming messages
                try:
                    data = await asyncio.wait_for(websocket.receive_json(), timeout=0.1)
                    if data.get("action") == "resume":
                        state.is_paused = False
                    elif data.get("action") == "next":
                        state.is_paused = False
                        state.current_section += 1
                        break
                    elif data.get("action") == "stop":
                        state.is_playing = False
                        await websocket.send_json({"type": "stopped"})
                        return
                except asyncio.TimeoutError:
                    pass

            if state.current_section >= len(sections):
                break

            # Check interrupt flag
            if state.interrupt_flag:
                await websocket.send_json({"type": "interrupted"})
                state.interrupt_flag = False
                continue

            # Get current section
            section = sections[state.current_section]
            content = section.get("content", "")
            images = section.get("images", [])

            # Send full section data at once (for sync with TTS)
            await websocket.send_json({
                "type": "section",
                "section_index": state.current_section,
                "title": section.get("title", ""),
                "content": content,
                "images": images,
                "key_takeaways": section.get("key_takeaways", []),
                "total_sections": len(sections)
            })

            # Wait for client to signal ready for next (after TTS completes)
            # Or timeout after reasonable time
            try:
                while True:
                    if state.is_paused or state.interrupt_flag:
                        break

                    try:
                        data = await asyncio.wait_for(websocket.receive_json(), timeout=0.5)
                        if data.get("action") == "section_done":
                            state.current_section += 1
                            break
                        elif data.get("action") == "next":
                            state.current_section += 1
                            break
                        elif data.get("action") == "pause":
                            state.is_paused = True
                            break
                        elif data.get("action") == "stop":
                            state.is_playing = False
                            await websocket.send_json({"type": "stopped"})
                            return
                    except asyncio.TimeoutError:
                        pass
            except Exception:
                break

        # Presentation complete
        await websocket.send_json({"type": "complete"})
        state.reset()

    except WebSocketDisconnect:
        state.reset()
    except Exception as e:
        await websocket.send_json({"type": "error", "message": str(e)})
        state.reset()

# ============================================================================
# Admin API Routes
# ============================================================================

class AdminLogin(BaseModel):
    username: str
    password: str

class SettingsUpdate(BaseModel):
    tts_voice: Optional[str] = None
    tts_enabled: Optional[str] = None
    presentation_speed: Optional[str] = None
    section_delay: Optional[str] = None

class UserRegister(BaseModel):
    name: str
    email: str
    phone: str

# Processing state for PDF upload
processing_state = {
    "stage": "idle",
    "current_page": 0,
    "total_pages": 0,
    "message": ""
}

def verify_token(authorization: str = None):
    """Verify admin token from Authorization header"""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    token = authorization.replace("Bearer ", "")
    admin_id = db.verify_admin_token(token)
    if not admin_id:
        raise HTTPException(status_code=401, detail="Invalid token")
    return admin_id

# Admin Authentication
@app.post("/admin/api/login")
async def admin_login(credentials: AdminLogin):
    """Admin login endpoint"""
    admin = db.verify_admin(credentials.username, credentials.password)
    if not admin:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    token = db.create_admin_token(admin["id"])
    return {"token": token, "username": admin["username"]}

# Admin Pages
@app.get("/admin")
@app.get("/admin/dashboard")
async def serve_admin_dashboard():
    """Serve admin dashboard"""
    return FileResponse("admin/dashboard.html")

@app.get("/admin/login")
async def serve_admin_login():
    """Serve admin login page"""
    return FileResponse("admin/login.html")

# Settings API
@app.get("/admin/api/settings")
async def get_admin_settings(authorization: str = None):
    """Get all settings"""
    from fastapi import Header
    return db.get_all_settings()

@app.put("/admin/api/settings")
async def update_admin_settings(settings: SettingsUpdate, authorization: str = None):
    """Update settings"""
    from fastapi import Header
    settings_dict = {k: v for k, v in settings.dict().items() if v is not None}
    db.update_settings(settings_dict)
    return {"status": "success"}

# Public settings endpoint (for frontend)
@app.get("/api/settings")
async def get_public_settings():
    """Get settings for frontend"""
    settings = db.get_all_settings()
    return {
        "ttsVoice": settings.get("tts_voice", "asteria"),
        "ttsEnabled": settings.get("tts_enabled", "true") == "true",
        "presentationSpeed": float(settings.get("presentation_speed", "1")),
        "sectionDelay": float(settings.get("section_delay", "0.5"))
    }

# Public products endpoint (for frontend)
@app.get("/api/products")
async def get_public_products():
    """Get active products for frontend"""
    products = db.get_all_products(include_inactive=False)
    return [{"id": p["id"], "name": p["name"], "slug": p["slug"]} for p in products]

# Users API
@app.get("/admin/api/users")
async def get_all_users(authorization: str = None):
    """Get all registered users"""
    return db.get_all_users()

@app.get("/admin/api/users/{user_id}")
async def get_user(user_id: int, authorization: str = None):
    """Get user by ID"""
    user = db.get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user

@app.get("/admin/api/users/{user_id}/chat")
async def get_user_chat(user_id: int, authorization: str = None):
    """Get user's chat history"""
    return db.get_user_chat_history(user_id)

@app.delete("/admin/api/users/{user_id}")
async def delete_user(user_id: int, authorization: str = None):
    """Delete a user"""
    if db.delete_user(user_id):
        return {"status": "success"}
    raise HTTPException(status_code=404, detail="User not found")

# User registration (public endpoint for frontend)
@app.post("/api/user/register")
async def register_user(user: UserRegister):
    """Register a new user"""
    user_id = db.create_user(user.name, user.email, user.phone)
    if user_id:
        return {"status": "success", "user_id": user_id}
    raise HTTPException(status_code=400, detail="Registration failed")

# Analytics API
@app.get("/admin/api/analytics/summary")
async def get_analytics_summary(authorization: str = None):
    """Get analytics summary"""
    return db.get_analytics_summary()

@app.get("/admin/api/analytics/recent")
async def get_recent_activity(authorization: str = None):
    """Get recent activity"""
    return db.get_recent_activity()

# JSON Content API
@app.get("/admin/api/json/{json_type}")
async def get_json_content(json_type: str, authorization: str = None):
    """Get JSON file content"""
    if json_type == "presentation":
        path = "output/presentation.json"
    elif json_type == "analysis":
        path = "output/analysis_results.json"
    else:
        raise HTTPException(status_code=400, detail="Invalid JSON type")

    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="File not found")

    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)

@app.put("/admin/api/json/{json_type}")
async def update_json_content(json_type: str, content: dict, authorization: str = None):
    """Update JSON file content"""
    if json_type == "presentation":
        path = "output/presentation.json"
    elif json_type == "analysis":
        path = "output/analysis_results.json"
    else:
        raise HTTPException(status_code=400, detail="Invalid JSON type")

    with open(path, "w", encoding="utf-8") as f:
        json.dump(content, f, indent=2, ensure_ascii=False)

    return {"status": "success"}

# Images API
@app.get("/admin/api/images")
async def get_all_images(show_deleted: bool = False, authorization: str = None):
    """Get all images with their status"""
    images_dir = Path("output/images")
    if not images_dir.exists():
        return []

    image_statuses = db.get_all_image_statuses()
    images = []

    # Look for both PNG and WebP images
    for pattern in ["*.png", "*.webp", "*.jpg", "*.jpeg"]:
        for img_path in images_dir.glob(pattern):
            path_str = f"output/images/{img_path.name}"
            is_deleted = image_statuses.get(path_str, False)

            if show_deleted or not is_deleted:
                images.append({
                    "path": path_str,
                    "is_deleted": is_deleted
                })

    return sorted(images, key=lambda x: x["path"])

@app.delete("/admin/api/images/{path:path}")
async def delete_image_admin(path: str, authorization: str = None):
    """Soft delete an image"""
    db.delete_image(path)
    return {"status": "success"}

@app.post("/admin/api/images/{path:path}/restore")
async def restore_image_admin(path: str, authorization: str = None):
    """Restore a soft deleted image"""
    db.restore_image(path)
    return {"status": "success"}

# ============================================================================
# Products API
# ============================================================================

class ProductCreate(BaseModel):
    name: str
    slug: str
    description: Optional[str] = ""

# Product processing state (per product)
product_processing_states = {}

@app.get("/admin/api/products")
async def get_all_products(authorization: str = None):
    """Get all products"""
    return db.get_all_products(include_inactive=True)

@app.post("/admin/api/products")
async def create_product(product: ProductCreate, authorization: str = None):
    """Create a new product"""
    product_id = db.create_product(product.name, product.slug, product.description)
    if product_id:
        # Ensure product folder exists
        db.ensure_product_folder(product_id)
        return {"id": product_id, "status": "success"}
    raise HTTPException(status_code=400, detail="Failed to create product. Slug may already exist.")

@app.get("/admin/api/products/{product_id}")
async def get_product(product_id: int, authorization: str = None):
    """Get a single product"""
    product = db.get_product_by_id(product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    return product

@app.delete("/admin/api/products/{product_id}")
async def delete_product(product_id: int, authorization: str = None):
    """Delete a product"""
    if db.delete_product(product_id):
        return {"status": "success"}
    raise HTTPException(status_code=404, detail="Product not found")

@app.post("/admin/api/products/{product_id}/upload")
async def upload_product_pdf(product_id: int, file: UploadFile = File(...), authorization: str = None):
    """Upload and process a PDF for a specific product"""
    global product_processing_states

    product = db.get_product_by_id(product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    if not file.filename.endswith('.pdf'):
        raise HTTPException(status_code=400, detail="File must be a PDF")

    # Get product folder
    product_folder = db.ensure_product_folder(product_id)

    # Save uploaded file
    pdf_path = product_folder / "input.pdf"
    with open(pdf_path, "wb") as f:
        content = await file.read()
        f.write(content)

    # Initialize processing state for this product
    product_processing_states[product_id] = {
        "stage": "analyzing",
        "current_page": 0,
        "total_pages": 0,
        "progress": 0,
        "message": "Starting..."
    }

    # Run processing in background with real-time logging
    import subprocess
    import threading
    import sys

    def process_pdf():
        try:
            print(f"\n{'='*60}")
            print(f"[PROCESSING] Starting PDF processing for product {product_id}")
            print(f"[PROCESSING] PDF: {pdf_path}")
            print(f"[PROCESSING] Output: {product_folder}")
            print(f"{'='*60}\n")
            sys.stdout.flush()

            # Use Popen to stream output in real-time
            process = subprocess.Popen(
                ["python", "-u", "main.py", str(pdf_path), str(product_folder)],
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1
            )

            # Stream output line by line
            output_lines = []
            for line in process.stdout:
                print(f"[Product {product_id}] {line}", end='')
                sys.stdout.flush()
                output_lines.append(line)

            process.wait()

            print(f"\n{'='*60}")
            print(f"[PROCESSING] Process finished with return code: {process.returncode}")
            print(f"{'='*60}\n")
            sys.stdout.flush()

            if process.returncode == 0:
                product_processing_states[product_id]["stage"] = "complete"
                product_processing_states[product_id]["progress"] = 100
                product_processing_states[product_id]["message"] = "Processing complete!"
            else:
                product_processing_states[product_id]["stage"] = "error"
                error_output = ''.join(output_lines[-10:])  # Last 10 lines
                product_processing_states[product_id]["message"] = error_output[:500] if error_output else "Processing failed"

        except Exception as e:
            print(f"[PROCESSING ERROR] {e}")
            sys.stdout.flush()
            product_processing_states[product_id]["stage"] = "error"
            product_processing_states[product_id]["message"] = str(e)

    thread = threading.Thread(target=process_pdf)
    thread.start()

    return {"status": "processing started", "product_id": product_id}

@app.get("/admin/api/products/{product_id}/status")
async def get_product_processing_status(product_id: int, authorization: str = None):
    """Get PDF processing status for a product"""
    if product_id in product_processing_states:
        return product_processing_states[product_id]
    return {"stage": "idle", "progress": 0, "message": ""}

@app.post("/admin/api/products/{product_id}/process")
async def process_product_pdf(product_id: int, authorization: str = None):
    """Manually trigger PDF processing for a product that already has a PDF uploaded"""
    global product_processing_states

    product = db.get_product_by_id(product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    product_folder = db.get_product_folder(product_id)
    pdf_path = product_folder / "input.pdf"

    if not pdf_path.exists():
        raise HTTPException(status_code=404, detail="No PDF found for this product. Upload a PDF first.")

    # Initialize processing state
    product_processing_states[product_id] = {
        "stage": "analyzing",
        "current_page": 0,
        "total_pages": 0,
        "progress": 0,
        "message": "Starting processing..."
    }

    import subprocess
    import threading
    import sys

    def process_pdf():
        try:
            print(f"\n{'='*60}")
            print(f"[MANUAL PROCESSING] Starting PDF processing for product {product_id}")
            print(f"[MANUAL PROCESSING] PDF: {pdf_path}")
            print(f"[MANUAL PROCESSING] Output: {product_folder}")
            print(f"{'='*60}\n")
            sys.stdout.flush()

            # Use Popen to stream output in real-time
            process = subprocess.Popen(
                ["python", "-u", "main.py", str(pdf_path), str(product_folder)],
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1
            )

            # Stream output line by line
            output_lines = []
            for line in process.stdout:
                print(f"[Product {product_id}] {line}", end='')
                sys.stdout.flush()
                output_lines.append(line)

            process.wait()

            print(f"\n{'='*60}")
            print(f"[MANUAL PROCESSING] Process finished with return code: {process.returncode}")
            print(f"{'='*60}\n")
            sys.stdout.flush()

            if process.returncode == 0:
                product_processing_states[product_id]["stage"] = "complete"
                product_processing_states[product_id]["progress"] = 100
                product_processing_states[product_id]["message"] = "Processing complete!"
            else:
                product_processing_states[product_id]["stage"] = "error"
                error_output = ''.join(output_lines[-10:])
                product_processing_states[product_id]["message"] = error_output[:500] if error_output else "Processing failed"

        except Exception as e:
            print(f"[MANUAL PROCESSING ERROR] {e}")
            sys.stdout.flush()
            product_processing_states[product_id]["stage"] = "error"
            product_processing_states[product_id]["message"] = str(e)

    thread = threading.Thread(target=process_pdf)
    thread.start()

    return {"status": "processing started", "product_id": product_id}

# Product-specific JSON API
@app.get("/admin/api/products/{product_id}/json/{json_type}")
async def get_product_json(product_id: int, json_type: str, authorization: str = None):
    """Get JSON file content for a specific product"""
    product = db.get_product_by_id(product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    product_folder = db.get_product_folder(product_id)

    if json_type == "presentation":
        path = product_folder / "presentation.json"
    elif json_type == "analysis":
        path = product_folder / "analysis_results.json"
    else:
        raise HTTPException(status_code=400, detail="Invalid JSON type")

    if not path.exists():
        raise HTTPException(status_code=404, detail="File not found. Upload and process a PDF first.")

    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)

@app.put("/admin/api/products/{product_id}/json/{json_type}")
async def update_product_json(product_id: int, json_type: str, content: dict, authorization: str = None):
    """Update JSON file content for a specific product"""
    product = db.get_product_by_id(product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    product_folder = db.get_product_folder(product_id)

    if json_type == "presentation":
        path = product_folder / "presentation.json"
    elif json_type == "analysis":
        path = product_folder / "analysis_results.json"
    else:
        raise HTTPException(status_code=400, detail="Invalid JSON type")

    with open(path, "w", encoding="utf-8") as f:
        json.dump(content, f, indent=2, ensure_ascii=False)

    return {"status": "success"}

# Product-specific Images API
@app.get("/admin/api/products/{product_id}/images")
async def get_product_images(product_id: int, show_deleted: bool = False, authorization: str = None):
    """Get all images for a specific product"""
    product = db.get_product_by_id(product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    product_folder = db.get_product_folder(product_id)
    images_dir = product_folder / "images"

    if not images_dir.exists():
        return []

    image_statuses = db.get_all_image_statuses()
    images = []

    # Look for both PNG and WebP images
    for pattern in ["*.png", "*.webp", "*.jpg", "*.jpeg"]:
        for img_path in images_dir.glob(pattern):
            path_str = str(img_path)
            is_deleted = image_statuses.get(path_str, False)

            if show_deleted or not is_deleted:
                images.append({
                    "path": path_str,
                    "filename": img_path.name,
                    "is_deleted": is_deleted
                })

    return sorted(images, key=lambda x: x["filename"])

# PDF Upload and Processing (Legacy - kept for backward compatibility)
@app.post("/admin/api/upload")
async def upload_pdf(file: UploadFile = File(...), authorization: str = None):
    """Upload and process a PDF"""
    global processing_state

    if not file.filename.endswith('.pdf'):
        raise HTTPException(status_code=400, detail="File must be a PDF")

    # Save uploaded file
    pdf_path = Path("input.pdf")
    with open(pdf_path, "wb") as f:
        content = await file.read()
        f.write(content)

    # Start processing in background
    processing_state = {
        "stage": "analyzing",
        "current_page": 0,
        "total_pages": 0,
        "message": "Starting..."
    }

    # Run processing (simplified - in production use background task)
    import subprocess
    try:
        result = subprocess.run(
            ["python", "main.py", str(pdf_path)],
            capture_output=True,
            text=True,
            timeout=600  # 10 minute timeout
        )
        if result.returncode == 0:
            processing_state["stage"] = "complete"
        else:
            processing_state["stage"] = "error"
            processing_state["message"] = result.stderr[:500]
    except Exception as e:
        processing_state["stage"] = "error"
        processing_state["message"] = str(e)

    return {"status": "processing started"}

@app.get("/admin/api/processing-status")
async def get_processing_status(authorization: str = None):
    """Get PDF processing status"""
    return processing_state

# ============================================================================
# Serve Static Files and Images
# ============================================================================
@app.get("/images/{path:path}")
async def serve_image(path: str):
    """Serve images from output directory, checking deletion status"""
    full_path = f"output/images/{path}"
    if db.is_image_deleted(full_path):
        raise HTTPException(status_code=404, detail="Image not found")

    image_path = Path("output/images") / path
    if image_path.exists():
        # Determine media type
        media_type = "image/webp" if path.endswith(".webp") else "image/png"
        # Cache images for 1 hour (browser will use cached version)
        return FileResponse(
            image_path,
            media_type=media_type,
            headers={"Cache-Control": "public, max-age=3600"}
        )
    raise HTTPException(status_code=404, detail="Image not found")

@app.get("/products/{product_id}/images/{filename}")
async def serve_product_image(product_id: int, filename: str):
    """Serve images for a specific product"""
    product_folder = db.get_product_folder(product_id)
    image_path = product_folder / "images" / filename

    # Check deletion status
    if db.is_image_deleted(str(image_path)):
        raise HTTPException(status_code=404, detail="Image not found")

    if image_path.exists():
        # Determine media type
        media_type = "image/webp" if filename.endswith(".webp") else "image/png"
        # Cache images for 1 hour (browser will use cached version)
        return FileResponse(
            image_path,
            media_type=media_type,
            headers={"Cache-Control": "public, max-age=3600"}
        )
    raise HTTPException(status_code=404, detail="Image not found")

@app.get("/products/{product_id}/pdf")
async def serve_product_pdf(product_id: int):
    """Serve PDF for a specific product"""
    product_folder = db.get_product_folder(product_id)

    # Check for input.pdf first, then any PDF
    pdf_path = product_folder / "input.pdf"
    if not pdf_path.exists():
        # For product 1, check root folder
        if product_id == 1:
            root_pdfs = list(Path(".").glob("*.pdf"))
            if root_pdfs:
                pdf_path = root_pdfs[0]

    if pdf_path.exists():
        # Use Content-Disposition: inline to display in browser instead of download
        return FileResponse(
            pdf_path,
            media_type="application/pdf",
            headers={"Content-Disposition": "inline"}
        )
    raise HTTPException(status_code=404, detail="PDF not found")

@app.get("/admin/api/products/{product_id}/pdf-info")
async def get_product_pdf_info(product_id: int, authorization: str = None):
    """Get PDF info for a product"""
    product_folder = db.get_product_folder(product_id)
    pdf_path = product_folder / "input.pdf"

    # For product 1, check root folder if input.pdf doesn't exist
    if not pdf_path.exists() and product_id == 1:
        root_pdfs = list(Path(".").glob("*.pdf"))
        if root_pdfs:
            pdf_path = root_pdfs[0]

    if pdf_path.exists():
        return {
            "exists": True,
            "filename": pdf_path.name,
            "size": pdf_path.stat().st_size,
            "url": f"/products/{product_id}/pdf"
        }
    return {"exists": False}

# Serve frontend
@app.get("/")
async def serve_frontend():
    """Serve the main HTML page"""
    return FileResponse("frontend/index.html")

# Mount static files
if os.path.exists("frontend"):
    app.mount("/static", StaticFiles(directory="frontend"), name="static")

# Mount admin static files
if os.path.exists("admin"):
    app.mount("/admin/static", StaticFiles(directory="admin"), name="admin_static")

# Serve admin CSS and JS directly
@app.get("/admin/admin.css")
async def serve_admin_css():
    return FileResponse("admin/admin.css", media_type="text/css")

@app.get("/admin/admin.js")
async def serve_admin_js():
    return FileResponse("admin/admin.js", media_type="application/javascript")

# ============================================================================
# Main
# ============================================================================
def generate_self_signed_cert():
    """Generate self-signed certificate for HTTPS (required for microphone access)"""
    import subprocess

    cert_file = "cert.pem"
    key_file = "key.pem"

    if not os.path.exists(cert_file) or not os.path.exists(key_file):
        print("Generating self-signed SSL certificate for HTTPS...")
        subprocess.run([
            "openssl", "req", "-x509", "-newkey", "rsa:4096",
            "-keyout", key_file, "-out", cert_file,
            "-days", "365", "-nodes",
            "-subj", "/CN=localhost"
        ], check=True)
        print("SSL certificate generated.")

    return cert_file, key_file

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--no-ssl", action="store_true", help="Run without SSL (microphone won't work)")
    args = parser.parse_args()

    # Create frontend directory if not exists
    os.makedirs("frontend", exist_ok=True)

    print("Starting Presentation Server...")

    if args.no_ssl:
        print("Open http://localhost:8000 in your browser")
        print("WARNING: Microphone access requires HTTPS. Use without --no-ssl for voice features.")
        uvicorn.run(app, host="0.0.0.0", port=8000)
    else:
        cert_file, key_file = generate_self_signed_cert()
        print("Open http://localhost:8000 in your browser")
        print("NOTE: You'll need to accept the self-signed certificate warning in your browser.")
        uvicorn.run(app, host="0.0.0.0", port=8000, ssl_certfile=cert_file, ssl_keyfile=key_file)
        # print("Open http://localhost:8000 in your browser")
        # print("WARNING: Microphone access requires HTTPS. Use without --no-ssl for voice features.")
        # uvicorn.run(app, host="0.0.0.0", port=8000)
