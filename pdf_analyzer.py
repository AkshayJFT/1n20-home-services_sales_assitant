"""
PDF Analyzer using OpenRouter Qwen VL

Approach:
1. Convert PDF page to image
2. Send to Qwen VL to analyze content and get image coordinates
3. Use OpenCV to find nearest image block and extract
"""

import fitz  # PyMuPDF
import cv2
import numpy as np
import base64
import json
import os
import io
from PIL import Image
from openai import OpenAI
from typing import List, Dict, Optional
from dotenv import load_dotenv

load_dotenv(override=True)

# Image optimization settings
MAX_IMAGE_WIDTH = 1400  # Max width in pixels
WEBP_QUALITY = 90       # WebP quality (0-100)


def optimize_image(cv2_image, max_width=MAX_IMAGE_WIDTH, quality=WEBP_QUALITY):
    """
    Optimize image for web delivery:
    - Resize if larger than max_width (maintains aspect ratio)
    - Convert to WebP format with quality setting
    Returns: (optimized_bytes, extension)
    """
    # Convert BGR (OpenCV) to RGB (PIL)
    rgb_image = cv2.cvtColor(cv2_image, cv2.COLOR_BGR2RGB)
    pil_image = Image.fromarray(rgb_image)

    # Resize if too large
    width, height = pil_image.size
    if width > max_width:
        ratio = max_width / width
        new_height = int(height * ratio)
        pil_image = pil_image.resize((max_width, new_height), Image.LANCZOS)
        print(f"    Resized: {width}x{height} -> {max_width}x{new_height}")

    # Save as WebP
    buffer = io.BytesIO()
    pil_image.save(buffer, format='WEBP', quality=quality, method=6)

    return buffer.getvalue(), '.webp'


class PDFAnalyzer:
    def __init__(self, api_key: Optional[str] = None):
        """Initialize PDF Analyzer with OpenRouter client"""
        api_key = api_key or os.getenv("OPENROUTER_API_KEY")

        self.client = OpenAI(
            base_url="https://openrouter.ai/api/v1",
            api_key=api_key
        )
        self.vlm_model = "anthropic/claude-opus-4.5"  # Qwen VL on OpenRouter

    def pdf_page_to_image(self, pdf_path: str, page_num: int, dpi: int = 150) -> tuple:
        """Convert a PDF page to image bytes"""
        doc = fitz.open(pdf_path)
        page = doc[page_num]

        mat = fitz.Matrix(dpi / 72, dpi / 72)
        pix = page.get_pixmap(matrix=mat)

        img_bytes = pix.tobytes("png")
        doc.close()

        return img_bytes, pix.width, pix.height

    def image_to_base64(self, img_bytes: bytes) -> str:
        """Convert image bytes to base64 string"""
        return base64.b64encode(img_bytes).decode('utf-8')

    def analyze_page_with_vlm(self, page_image_bytes: bytes) -> Dict:
        """Send page image to VLM for analysis"""

        base64_image = self.image_to_base64(page_image_bytes)

        prompt = """Analyze this document page carefully and extract information in JSON format.

Instructions:
1. Summarize the main content of this page
2. List key points or important information
3. For images on this page, identify them smartly:
   - If there's a CLUSTER or GRID of related small images (like color swatches, product variations, multiple diagrams),
     treat the ENTIRE cluster as ONE image and provide coordinates covering the whole group
   - For standalone large images (photos, diagrams, charts), identify them individually
   - SKIP logos, icons, small decorative elements
   - Provide bounding box as percentages (0-100) of page: [x1, y1, x2, y2]

IMPORTANT:
- Prefer LARGER bounding boxes that capture complete visual elements
- If you see a row/grid of related images, give ONE bounding box covering ALL of them
- Example: A row of 5 color swatches = ONE image entry with coordinates covering all 5

Respond ONLY with valid JSON:
{
    "page_summary": "Brief summary of the page content",
    "key_points": ["point 1", "point 2"],
    "relevant_images": [
        {
            "description": "What the image/cluster shows",
            "relevance": "Why this is important",
            "coordinates_pct": [x1, y1, x2, y2],
            "is_cluster": true/false
        }
    ]
}

If no relevant images, return empty array for relevant_images."""

        try:
            completion = self.client.chat.completions.create(
                model=self.vlm_model,
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "image_url",
                                "image_url": {
                                    "url": f"data:image/png;base64,{base64_image}"
                                }
                            },
                            {
                                "type": "text",
                                "text": prompt
                            }
                        ]
                    }
                ],
                extra_headers={
                    "HTTP-Referer": "https://pdf-analyzer.local",
                    "X-Title": "PDF Analyzer"
                },
                temperature=0.3,
                max_tokens=1412
            )

            response_text = completion.choices[0].message.content

            # Parse JSON from response
            if "```json" in response_text:
                response_text = response_text.split("```json")[1].split("```")[0]
            elif "```" in response_text:
                response_text = response_text.split("```")[1].split("```")[0]

            result = json.loads(response_text.strip())
            return result

        except json.JSONDecodeError as e:
            print(f"Failed to parse VLM response as JSON: {e}")
            print(f"Raw response: {response_text}")
            return {
                "page_summary": "Failed to parse response",
                "key_points": [],
                "relevant_images": []
            }
        except Exception as e:
            print(f"VLM analysis failed: {e}")
            return {
                "page_summary": f"Error: {str(e)}",
                "key_points": [],
                "relevant_images": []
            }

    def detect_image_blocks(self, page_image_bytes: bytes) -> tuple:
        """Use OpenCV to detect all potential image blocks on the page"""

        nparr = np.frombuffer(page_image_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

        if img is None:
            return [], 0, 0

        img_height, img_width = img.shape[:2]
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

        # Apply Gaussian blur
        blurred = cv2.GaussianBlur(gray, (5, 5), 0)

        # Edge detection
        edges = cv2.Canny(blurred, 30, 150)

        # Dilate to connect nearby edges
        kernel = np.ones((7, 7), np.uint8)
        dilated = cv2.dilate(edges, kernel, iterations=3)

        # Find contours
        contours, _ = cv2.findContours(dilated, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        blocks = []
        min_area = (img_width * img_height) * 0.005

        for contour in contours:
            x, y, w, h = cv2.boundingRect(contour)
            area = w * h

            if area > min_area and w > 50 and h > 50:
                aspect_ratio = max(w, h) / min(w, h)
                if aspect_ratio < 10:
                    blocks.append({
                        "bbox": [x, y, x + w, y + h],
                        "center": [x + w / 2, y + h / 2],
                        "area": area,
                        "width": w,
                        "height": h
                    })

        blocks.sort(key=lambda b: b["area"], reverse=True)
        return blocks, img_width, img_height

    def merge_nearby_blocks(self, blocks: List[Dict], img_width: int, img_height: int,
                            distance_threshold_pct: float = 5.0) -> List[Dict]:
        """Merge blocks that are close together (likely a cluster/grid of images)"""

        if len(blocks) <= 1:
            return blocks

        # Distance threshold in pixels
        dist_threshold = max(img_width, img_height) * distance_threshold_pct / 100

        # Track which blocks have been merged
        merged = [False] * len(blocks)
        result = []

        for i, block_a in enumerate(blocks):
            if merged[i]:
                continue

            # Start a cluster with this block
            cluster_bboxes = [block_a["bbox"]]
            merged[i] = True

            # Find all nearby blocks
            for j, block_b in enumerate(blocks):
                if i == j or merged[j]:
                    continue

                # Check if blocks are close (within threshold)
                if self._blocks_are_nearby(block_a, block_b, dist_threshold):
                    cluster_bboxes.append(block_b["bbox"])
                    merged[j] = True

            # If multiple blocks merged, create combined bbox
            if len(cluster_bboxes) > 1:
                combined = self._merge_bboxes(cluster_bboxes)
                result.append({
                    "bbox": combined,
                    "center": [(combined[0] + combined[2]) / 2, (combined[1] + combined[3]) / 2],
                    "area": (combined[2] - combined[0]) * (combined[3] - combined[1]),
                    "width": combined[2] - combined[0],
                    "height": combined[3] - combined[1],
                    "is_cluster": True,
                    "cluster_count": len(cluster_bboxes)
                })
            else:
                block_a["is_cluster"] = False
                result.append(block_a)

        return result

    def _blocks_are_nearby(self, block_a: Dict, block_b: Dict, threshold: float) -> bool:
        """Check if two blocks are within threshold distance"""
        a = block_a["bbox"]
        b = block_b["bbox"]

        # Calculate min distance between bboxes
        # Horizontal distance
        if a[2] < b[0]:  # a is left of b
            h_dist = b[0] - a[2]
        elif b[2] < a[0]:  # b is left of a
            h_dist = a[0] - b[2]
        else:  # overlapping horizontally
            h_dist = 0

        # Vertical distance
        if a[3] < b[1]:  # a is above b
            v_dist = b[1] - a[3]
        elif b[3] < a[1]:  # b is above a
            v_dist = a[1] - b[3]
        else:  # overlapping vertically
            v_dist = 0

        distance = np.sqrt(h_dist**2 + v_dist**2)
        return distance < threshold

    def _merge_bboxes(self, bboxes: List[List[int]]) -> List[int]:
        """Merge multiple bboxes into one encompassing bbox"""
        x1 = min(b[0] for b in bboxes)
        y1 = min(b[1] for b in bboxes)
        x2 = max(b[2] for b in bboxes)
        y2 = max(b[3] for b in bboxes)
        return [x1, y1, x2, y2]

    def find_nearest_block(
        self,
        vlm_coords_pct: List[float],
        blocks: List[Dict],
        img_width: int,
        img_height: int,
        max_distance_pct: float = 20.0
    ) -> Optional[Dict]:
        """Find the detected block closest to VLM's approximate coordinates"""

        if not blocks or not vlm_coords_pct:
            return None

        # Convert percentage to pixels
        x1 = vlm_coords_pct[0] * img_width / 100
        y1 = vlm_coords_pct[1] * img_height / 100
        x2 = vlm_coords_pct[2] * img_width / 100
        y2 = vlm_coords_pct[3] * img_height / 100

        vlm_center = [(x1 + x2) / 2, (y1 + y2) / 2]
        vlm_area = (x2 - x1) * (y2 - y1)

        page_diagonal = np.sqrt(img_width**2 + img_height**2)
        max_distance = max_distance_pct * page_diagonal / 100

        best_block = None
        min_score = float('inf')

        for block in blocks:
            dist = np.sqrt(
                (block["center"][0] - vlm_center[0])**2 +
                (block["center"][1] - vlm_center[1])**2
            )

            if dist > max_distance:
                continue

            area_ratio = min(block["area"], vlm_area) / max(block["area"], vlm_area) if vlm_area > 0 else 0
            score = dist * (2 - area_ratio)

            if score < min_score:
                min_score = score
                best_block = block

        return best_block

    def extract_image_region(
        self,
        page_image_bytes: bytes,
        bbox: List[int],
        padding: int = 5
    ) -> np.ndarray:
        """Extract and crop the image region"""

        nparr = np.frombuffer(page_image_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

        h, w = img.shape[:2]
        x1, y1, x2, y2 = bbox

        x1 = max(0, int(x1) - padding)
        y1 = max(0, int(y1) - padding)
        x2 = min(w, int(x2) + padding)
        y2 = min(h, int(y2) + padding)

        cropped = img[y1:y2, x1:x2]
        return cropped

    def process_page(self, pdf_path: str, page_num: int) -> Dict:
        """Process a single PDF page"""

        print(f"Processing page {page_num + 1}...")

        # Convert page to image
        page_image, img_width, img_height = self.pdf_page_to_image(pdf_path, page_num)
        print(f"  - Page converted: {img_width}x{img_height}")

        # Analyze with VLM
        print(f"  - Analyzing with VLM...")
        vlm_result = self.analyze_page_with_vlm(page_image)
        print(f"  - Found {len(vlm_result.get('relevant_images', []))} relevant images/clusters")

        # Detect blocks with OpenCV
        print(f"  - Detecting image blocks...")
        blocks, _, _ = self.detect_image_blocks(page_image)
        print(f"  - Detected {len(blocks)} potential blocks")

        # Merge nearby blocks into clusters
        print(f"  - Merging nearby blocks into clusters...")
        merged_blocks = self.merge_nearby_blocks(blocks, img_width, img_height)
        cluster_count = sum(1 for b in merged_blocks if b.get("is_cluster", False))
        print(f"  - After merging: {len(merged_blocks)} blocks ({cluster_count} clusters)")

        # Match and extract images
        extracted_images = []
        used_blocks = set()  # Track used blocks to avoid duplicates

        for idx, img_info in enumerate(vlm_result.get("relevant_images", [])):
            coords = img_info.get("coordinates_pct", [])

            if not coords or len(coords) != 4:
                print(f"  - Skipping image {idx + 1}: invalid coordinates")
                continue

            # First try to find match in merged blocks
            matched_block = self.find_nearest_block(coords, merged_blocks, img_width, img_height)

            if matched_block:
                block_key = tuple(matched_block["bbox"])

                # Skip if already extracted this block
                if block_key in used_blocks:
                    print(f"  - Skipping duplicate block for image {idx + 1}")
                    continue

                used_blocks.add(block_key)
                cropped = self.extract_image_region(page_image, matched_block["bbox"])

                is_cluster = matched_block.get("is_cluster", False)
                cluster_info = f" (cluster of {matched_block.get('cluster_count', 1)})" if is_cluster else ""

                extracted_images.append({
                    "image": cropped,
                    "description": img_info.get("description", ""),
                    "relevance": img_info.get("relevance", ""),
                    "vlm_coords_pct": coords,
                    "actual_bbox": matched_block["bbox"],
                    "is_cluster": is_cluster
                })
                print(f"  - Extracted image {idx + 1}{cluster_info}: {img_info.get('description', '')[:50]}...")
            else:
                # Fallback: extract directly from VLM coordinates if no block found
                x1 = int(coords[0] * img_width / 100)
                y1 = int(coords[1] * img_height / 100)
                x2 = int(coords[2] * img_width / 100)
                y2 = int(coords[3] * img_height / 100)

                # Only use fallback if area is reasonable
                area = (x2 - x1) * (y2 - y1)
                min_area = img_width * img_height * 0.01  # At least 1% of page

                if area > min_area:
                    cropped = self.extract_image_region(page_image, [x1, y1, x2, y2])
                    extracted_images.append({
                        "image": cropped,
                        "description": img_info.get("description", ""),
                        "relevance": img_info.get("relevance", ""),
                        "vlm_coords_pct": coords,
                        "actual_bbox": [x1, y1, x2, y2],
                        "is_cluster": img_info.get("is_cluster", False)
                    })
                    print(f"  - Extracted image {idx + 1} (fallback): {img_info.get('description', '')[:50]}...")
                else:
                    print(f"  - No matching block for image {idx + 1}")

        return {
            "page_num": page_num,
            "page_summary": vlm_result.get("page_summary", ""),
            "key_points": vlm_result.get("key_points", []),
            "images": extracted_images,
            "page_image": page_image
        }

    def process_pdf(self, pdf_path: str, output_dir: str = "output") -> List[Dict]:
        """Process entire PDF"""

        os.makedirs(output_dir, exist_ok=True)
        images_dir = os.path.join(output_dir, "images")
        os.makedirs(images_dir, exist_ok=True)

        doc = fitz.open(pdf_path)
        total_pages = len(doc)
        doc.close()

        print(f"Processing PDF: {pdf_path}")
        print(f"Total pages: {total_pages}")
        print("-" * 50)

        all_results = []

        for page_num in range(total_pages):
            result = self.process_page(pdf_path, page_num)

            # Save extracted images (optimized)
            for idx, img_data in enumerate(result["images"]):
                # Optimize image (resize + WebP compression)
                optimized_bytes, ext = optimize_image(img_data["image"])
                img_filename = f"page_{page_num + 1}_img_{idx + 1}{ext}"
                img_path = os.path.join(images_dir, img_filename)

                with open(img_path, 'wb') as f:
                    f.write(optimized_bytes)

                img_data["saved_path"] = img_path
                del img_data["image"]

            del result["page_image"]
            all_results.append(result)
            print("-" * 50)

        # Save JSON
        json_path = os.path.join(output_dir, "analysis_results.json")
        with open(json_path, "w", encoding="utf-8") as f:
            json.dump(all_results, f, indent=2, ensure_ascii=False)

        print(f"\nResults saved to: {json_path}")
        print(f"Images saved to: {images_dir}")

        return all_results


def main():
    import sys

    if len(sys.argv) < 2:
        print("Usage: python pdf_analyzer.py <pdf_path> [output_dir]")
        sys.exit(1)

    pdf_path = sys.argv[1]
    output_dir = sys.argv[2] if len(sys.argv) > 2 else "output"

    if not os.path.exists(pdf_path):
        print(f"Error: PDF not found: {pdf_path}")
        sys.exit(1)

    analyzer = PDFAnalyzer()
    results = analyzer.process_pdf(pdf_path, output_dir)

    # Summary
    print("\n" + "=" * 50)
    print("SUMMARY")
    print("=" * 50)

    total_images = 0
    for result in results:
        print(f"\nPage {result['page_num'] + 1}:")
        print(f"  Summary: {result['page_summary'][:100]}...")
        print(f"  Images: {len(result['images'])}")
        total_images += len(result["images"])

    print(f"\nTotal images extracted: {total_images}")


if __name__ == "__main__":
    main()
