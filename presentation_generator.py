"""
Presentation Generator using Groq LLM

Multi-stage approach:
1. Analyze document themes
2. Create dynamic presentation structure
3. Generate content per section
4. Robust image matching (page-wise priority + description matching)
"""

import json
import os
import re
from typing import Dict, List, Optional, Tuple
from groq import Groq
from dotenv import load_dotenv

load_dotenv()


class PresentationGenerator:
    def __init__(self, groq_api_key: Optional[str] = None):
        """Initialize with Groq client"""
        api_key = groq_api_key or os.getenv("GROQ_API_KEY")
        self.client = Groq(api_key=api_key)
        self.llm_model = "openai/gpt-oss-120b"

    def load_analysis_json(self, json_path: str) -> List[Dict]:
        """Load analysis JSON"""
        with open(json_path, "r", encoding="utf-8") as f:
            return json.load(f)

    def filter_small_images(self, analysis_data: List[Dict], min_area: int = 15000) -> List[Dict]:
        """Filter out small images (icons, logos)"""
        filtered_data = []
        removed = 0

        for page in analysis_data:
            filtered_page = page.copy()
            filtered_images = []

            for img in page.get('images', []):
                bbox = img.get('actual_bbox', [0, 0, 0, 0])
                if len(bbox) == 4:
                    width = bbox[2] - bbox[0]
                    height = bbox[3] - bbox[1]
                    area = width * height

                    if area >= min_area:
                        filtered_images.append(img)
                    else:
                        removed += 1
                else:
                    filtered_images.append(img)

            filtered_page['images'] = filtered_images
            filtered_data.append(filtered_page)

        if removed > 0:
            print(f"  Filtered {removed} small images")

        return filtered_data

    def _call_llm(self, system_prompt: str, user_prompt: str, temperature: float = 0.3, max_tokens: int = 4096) -> str:
        """Generic LLM call wrapper"""
        try:
            completion = self.client.chat.completions.create(
                model=self.llm_model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt}
                ],
                temperature=temperature,
                max_completion_tokens=max_tokens
            )
            return completion.choices[0].message.content
        except Exception as e:
            print(f"LLM Error: {e}")
            return None

    def _parse_json_response(self, response: str) -> Optional[Dict]:
        """Parse JSON from LLM response"""
        if not response:
            return None

        # Try to extract JSON from markdown code blocks
        if "```json" in response:
            response = response.split("```json")[1].split("```")[0]
        elif "```" in response:
            response = response.split("```")[1].split("```")[0]

        try:
            return json.loads(response.strip())
        except json.JSONDecodeError as e:
            print(f"JSON Parse Error: {e}")
            return None

    # =========================================================================
    # STAGE 1: Analyze Document Themes
    # =========================================================================
    def analyze_document_themes(self, analysis_data: List[Dict]) -> Dict:
        """
        First LLM call - Analyze all pages and identify main themes/topics.
        Returns theme clusters with associated page numbers.
        """
        print("  Stage 1: Analyzing document themes...")

        # Prepare condensed page summaries
        page_summaries = []
        for page in analysis_data:
            page_num = page['page_num'] + 1
            summary = page['page_summary']
            key_points = "; ".join(page['key_points'][:5])  # First 5 key points
            image_count = len(page.get('images', []))

            page_summaries.append(
                f"PAGE {page_num}: {summary}\n  Key points: {key_points}\n  Images: {image_count}"
            )

        pages_text = "\n\n".join(page_summaries)

        system_prompt = "You are a document analyst. Analyze content and identify themes. Output valid JSON only."

        user_prompt = f"""Analyze this document and identify the main themes/topics.

DOCUMENT PAGES:
{pages_text}

Task:
Identify distinct themes based on content. Be DETAILED - identify MANY themes.

CRITICAL PRODUCT SEPARATION RULES:
1. DETECT PRODUCT PAGES: If a page showcases a specific PRODUCT, PRODUCT TYPE, or PRODUCT VARIANT:
   - Look for product names, model numbers, product-specific features
   - Each distinct product MUST become its own separate theme
   - NEVER combine different products into the same theme

2. ONE PRODUCT = ONE THEME:
   - If Page 1 shows "Product A" and Page 2 shows "Product B", create TWO separate themes
   - Even if products are similar (e.g., different window types), keep them as separate themes
   - The theme_name MUST include the specific product name

3. PAGE ISOLATION FOR PRODUCTS:
   - A product theme should ONLY contain pages for that specific product
   - Do NOT mix pages from different products
   - If a single page has one product, that theme has only that one page

CRITICAL RULES FOR NON-PRODUCT (GENERIC) THEMES:

4. CREATE DETAILED THEMES FOR GENERIC CONTENT:
   - DO NOT lump all generic content into one or two themes
   - Break down generic content into SPECIFIC themes:
     * "Brand Introduction" - separate theme
     * "Company Overview/History" - separate theme
     * "Key Features & Benefits" - separate theme
     * "Technology & Innovation" - separate theme
     * "Energy Efficiency" - separate theme (if applicable)
     * "Glass Options/Packages" - separate theme (if applicable)
     * "Design & Customization" - separate theme
     * "Color Options" - separate theme (if applicable)
     * "Warranty Coverage" - separate theme
     * "Sustainability/Eco-friendly" - separate theme
     * "Contact Information" - separate theme

5. NON-PRODUCT THEME GUIDELINES:
   - Each distinct TOPIC should be its own theme
   - If a page covers multiple topics, it can belong to multiple themes
   - Limit non-product themes to 2-3 pages maximum each
   - More themes = more detailed presentation

6. IDENTIFY PRODUCT VS NON-PRODUCT:
   - Set "is_product_theme": true for product-specific themes
   - Set "is_product_theme": false for general/informational themes

7. TARGET THEME COUNT:
   - For documents with 10+ pages: identify 8-15 themes minimum
   - Product themes: one per product
   - Non-product themes: 5-8 themes covering different topics

Output JSON:
{{
  "document_title": "Main document title/subject",
  "document_type": "brochure/catalog/manual/etc",
  "themes": [
    {{
      "theme_id": 1,
      "theme_name": "Specific topic name (not generic like 'Overview')",
      "theme_description": "What this theme covers",
      "page_numbers": [1, 2],
      "content_type": "product/introduction/features/technology/energy/design/warranty/sustainability/contact",
      "is_product_theme": false,
      "priority": "high/medium/low"
    }}
  ]
}}

IMPORTANT:
- Product themes: strict isolation (one product per theme)
- Non-product themes: break into MANY specific themes (features, technology, warranty, etc. are SEPARATE)
- Aim for 8-15 total themes for comprehensive coverage
- Return ONLY valid JSON"""

        response = self._call_llm(system_prompt, user_prompt, temperature=0.2)
        result = self._parse_json_response(response)

        # Ensure is_product_theme flag exists for all themes
        if result and 'themes' in result:
            for theme in result['themes']:
                if 'is_product_theme' not in theme:
                    # Fallback: single-page themes with content_type 'product' are likely products
                    theme['is_product_theme'] = (
                        theme.get('content_type') == 'product' or
                        (len(theme.get('page_numbers', [])) == 1 and
                         theme.get('content_type') not in ['overview', 'introduction', 'conclusion', 'contact', 'warranty'])
                    )

        return result

    # =========================================================================
    # STAGE 2: Create Presentation Structure
    # =========================================================================
    def create_presentation_structure(self, themes: Dict, analysis_data: List[Dict]) -> List[Dict]:
        """
        Second LLM call - Create dynamic presentation structure based on themes.
        Returns list of section definitions.
        """
        print("  Stage 2: Creating presentation structure...")

        # Build page content reference
        page_content = {}
        for page in analysis_data:
            page_num = page['page_num'] + 1
            page_content[page_num] = {
                'summary': page['page_summary'],
                'key_points': page['key_points'],
                'image_count': len(page.get('images', []))
            }

        system_prompt = "You are a presentation architect. Design clear, logical presentation structures. Output valid JSON only."

        user_prompt = f"""Based on the document themes, create a presentation structure.

DOCUMENT INFO:
Title: {themes.get('document_title', 'Unknown')}
Type: {themes.get('document_type', 'Unknown')}

IDENTIFIED THEMES:
{json.dumps(themes.get('themes', []), indent=2)}

PAGE CONTENT REFERENCE:
{json.dumps(page_content, indent=2)}

CRITICAL RULES FOR PRODUCT SECTIONS:

1. ONE PRODUCT = ONE SECTION (OR MORE):
   - Each product theme MUST become its own dedicated section
   - NEVER combine multiple products into a single section
   - A product section draws content ONLY from that product's pages

2. STRICT PAGE-TO-SECTION BINDING FOR PRODUCTS:
   - If a theme has "is_product_theme": true, the section MUST use ONLY those exact pages
   - Images for a product section MUST come from that product's pages only
   - Do NOT mix source_pages from different products

CRITICAL RULES FOR NON-PRODUCT (GENERIC) SECTIONS:

3. CREATE DETAILED SECTIONS FOR GENERIC CONTENT:
   - DO NOT compress all generic content into 1-2 sections
   - Each major topic deserves its own section:
     * Introduction/Brand Overview = separate section
     * Features/Benefits = separate section
     * Technologies/Technical Details = separate section
     * Glass/Energy Efficiency = separate section (if applicable)
     * Design Options/Customization = separate section
     * Warranty = separate section
     * Sustainability/Eco-friendly = separate section
     * Contact/Conclusion = separate section

4. NON-PRODUCT SECTION GUIDELINES:
   - If a theme covers multiple distinct topics, SPLIT it into multiple sections
   - Each section should focus on ONE main topic (not 5 topics combined)
   - Aim for 2-3 pages maximum per non-product section
   - More sections = better presentation flow and detail

5. PRESENTATION FLOW:
   - Start with intro/overview (1-2 sections)
   - Features, technologies, benefits (multiple sections)
   - Each product gets its own section(s)
   - Design options, customization (if applicable)
   - Warranty, sustainability, contact (separate sections)

6. TARGET SECTION COUNT:
   - For documents with 10+ pages: aim for 8-15 sections
   - Generic content should have at least 4-6 sections
   - Product content: 1 section per product

Output JSON:
{{
  "presentation_title": "Title for the presentation",
  "sections": [
    {{
      "section_id": 1,
      "section_type": "intro/overview/feature/product/technical/lifestyle/warranty/sustainability/conclusion",
      "title": "Section title (use product name for product sections)",
      "purpose": "What this section should communicate",
      "source_pages": [1, 2],
      "is_product_section": false,
      "content_focus": ["ONE main topic - not multiple combined"],
      "image_priority": "lifestyle/technical/product/diagram",
      "target_image_count": 2
    }}
  ]
}}

IMPORTANT:
- Product sections: strict page isolation
- Non-product sections: break into MULTIPLE detailed sections, not one mega-section
- Each section should cover ONE focused topic
- Aim for 8-15 total sections for a comprehensive presentation

Return ONLY valid JSON."""

        response = self._call_llm(system_prompt, user_prompt, temperature=0.2)
        result = self._parse_json_response(response)

        if result:
            sections = result.get('sections', [])
            # Ensure is_product_section flag exists (default to False for generic PDFs)
            for section in sections:
                if 'is_product_section' not in section:
                    # Fallback: check if section_type is 'product' or has single source page
                    section['is_product_section'] = (
                        section.get('section_type') == 'product' or
                        (len(section.get('source_pages', [])) == 1 and
                         section.get('section_type') not in ['intro', 'overview', 'conclusion', 'contact'])
                    )
            return sections
        return []

    # =========================================================================
    # STAGE 3: Build Page-Image Index
    # =========================================================================
    def build_page_image_index(self, analysis_data: List[Dict]) -> Dict:
        """
        Build comprehensive index of images organized by page.
        Returns: {page_num: [image_info, ...]}
        """
        page_image_index = {}

        for page in analysis_data:
            page_num = page['page_num'] + 1
            images = []

            for img in page.get('images', []):
                images.append({
                    'path': img['saved_path'],
                    'description': img['description'],
                    'relevance': img.get('relevance', ''),
                    'keywords': self._extract_keywords(img['description'] + ' ' + img.get('relevance', ''))
                })

            page_image_index[page_num] = images

        return page_image_index

    def _extract_keywords(self, text: str) -> List[str]:
        """Extract meaningful keywords from text"""
        # Convert to lowercase and extract words
        text = text.lower()
        words = re.findall(r'\b[a-z]{3,}\b', text)

        # Filter common words
        stopwords = {'the', 'and', 'for', 'with', 'this', 'that', 'from', 'are', 'was', 'were',
                     'been', 'being', 'have', 'has', 'had', 'does', 'did', 'will', 'would',
                     'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'into',
                     'through', 'during', 'before', 'after', 'above', 'below', 'between',
                     'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when',
                     'where', 'why', 'how', 'all', 'each', 'few', 'more', 'most', 'other',
                     'some', 'such', 'only', 'own', 'same', 'than', 'too', 'very', 'just',
                     'also', 'now', 'image', 'shows', 'showing', 'shown', 'display', 'displays',
                     'featuring', 'features', 'includes', 'including', 'appears', 'visible'}

        keywords = [w for w in words if w not in stopwords]
        return list(set(keywords))

    # =========================================================================
    # STAGE 4: Generate Section Content
    # ========================================================================
    def generate_section_content(self, section: Dict, analysis_data: List[Dict],
                                  page_image_index: Dict) -> Dict:
        """
        Per-section LLM call - Generate content for a single section.
        Uses only relevant pages for focused generation.
        """
        source_pages = section.get('source_pages', [])

        # Gather content from source pages only
        page_contents = []
        available_images = []

        for page in analysis_data:
            page_num = page['page_num'] + 1
            if page_num in source_pages:
                page_contents.append({
                    'page': page_num,
                    'summary': page['page_summary'],
                    'key_points': page['key_points']
                })

                # Add images from this page
                for img in page_image_index.get(page_num, []):
                    available_images.append({
                        'page': page_num,
                        'path': img['path'],
                        'description': img['description'],
                        'relevance': img['relevance']
                    })

        system_prompt = "You are a content writer creating customer-friendly presentation content. Output valid JSON only."

        is_product_section = section.get('is_product_section', False)

        user_prompt = f"""Write content for this presentation section.

SECTION INFO:
Title: {section.get('title', 'Untitled')}
Type: {section.get('section_type', 'general')}
Purpose: {section.get('purpose', '')}
Content Focus: {section.get('content_focus', [])}
Is Product Section: {is_product_section}

SOURCE PAGE CONTENT:
{json.dumps(page_contents, indent=2)}

AVAILABLE IMAGES (from source pages ONLY):
{json.dumps(available_images, indent=2)}

Write the section content and select images.

CRITICAL IMAGE SELECTION RULES:
1. You MUST ONLY select images from the AVAILABLE IMAGES list above
2. These images are ALREADY filtered to source pages - do NOT imagine other images
3. Use the EXACT path as shown in the available images
4. For product sections: images MUST be from that product's page only
5. Select up to {section.get('target_image_count', 2)} images maximum

{"PRODUCT SECTION RULE: This is a product-specific section. Content and images must be ONLY about this specific product. Do not reference other products." if is_product_section else ""}

Output JSON:
{{
  "title": "Final section title",
  "content": "Rich, detailed paragraph (4-6 sentences). Customer-friendly language. Include specific product names and benefits.",
  "selected_images": [
    {{
      "path": "EXACT path from available images list",
      "reason": "Why this image is relevant"
    }}
  ],
  "key_takeaways": ["bullet point 1", "bullet point 2"]
}}

VALIDATION:
- Every image path MUST exist in the AVAILABLE IMAGES list above
- Do NOT invent or guess image paths
- If no images are available, return empty selected_images array

Return ONLY valid JSON."""

        response = self._call_llm(system_prompt, user_prompt, temperature=0.3)
        result = self._parse_json_response(response)

        if result:
            # Add source pages to result
            result['source_pages'] = source_pages
            # Preserve product section flag for downstream processing
            result['is_product_section'] = section.get('is_product_section', False)
            # Extract just the image paths
            result['images'] = [img['path'] for img in result.get('selected_images', [])]

        return result

    # =========================================================================
    # STAGE 5: Validate and Fix Image Bindings
    # =========================================================================
    def validate_image_bindings(self, section: Dict, page_image_index: Dict) -> Dict:
        """
        Validate that all images in section exist and come from source pages.
        Fix any invalid references.
        """
        source_pages = section.get('source_pages', [])

        # Build set of valid image paths from source pages
        valid_paths = set()
        for page_num in source_pages:
            for img in page_image_index.get(page_num, []):
                valid_paths.add(img['path'])

        # Filter images to only valid ones
        original_images = section.get('images', [])
        valid_images = [img for img in original_images if img in valid_paths]

        # If we lost images, try to find replacements from source pages
        if len(valid_images) < len(original_images):
            needed = len(original_images) - len(valid_images)
            for page_num in source_pages:
                for img in page_image_index.get(page_num, []):
                    if img['path'] not in valid_images:
                        valid_images.append(img['path'])
                        needed -= 1
                        if needed <= 0:
                            break
                if needed <= 0:
                    break

        section['images'] = valid_images
        return section

    # =========================================================================
    # STAGE 6: Image-Content Matching (Algorithmic Enhancement)
    # =========================================================================
    def enhance_image_matching(self, section: Dict, page_image_index: Dict) -> Dict:
        """
        Algorithmic enhancement of image matching.
        Score images based on keyword overlap with content.
        STRICT: For product sections, only use images from source pages.
        """
        content = section.get('content', '') + ' ' + section.get('title', '')
        content_keywords = set(self._extract_keywords(content))

        source_pages = section.get('source_pages', [])
        target_count = max(2, len(section.get('images', [])))
        is_product_section = section.get('is_product_section', False)

        # Build set of valid paths from source pages ONLY
        valid_source_paths = set()
        for page_num in source_pages:
            for img in page_image_index.get(page_num, []):
                valid_source_paths.add(img['path'])

        # Score all available images from source pages ONLY
        scored_images = []
        for page_num in source_pages:
            for img in page_image_index.get(page_num, []):
                img_keywords = set(img['keywords'])
                overlap = len(content_keywords & img_keywords)

                # Higher bonus for product sections to prefer primary page
                page_bonus = 3 if page_num == source_pages[0] else 1

                score = overlap * page_bonus + 1  # +1 base score so all source images are considered
                scored_images.append({
                    'path': img['path'],
                    'page': page_num,
                    'score': score,
                    'description': img['description'][:100]
                })

        # Sort by score and take top matches
        scored_images.sort(key=lambda x: x['score'], reverse=True)

        # STRICT VALIDATION: Remove any images not from source pages
        current_images = section.get('images', [])
        validated_images = [img for img in current_images if img in valid_source_paths]

        # If we lost images due to validation, log it
        if len(validated_images) < len(current_images):
            removed = len(current_images) - len(validated_images)
            # Images were from wrong pages - this is expected behavior

        best_images = []
        for img in scored_images[:target_count]:
            best_images.append(img['path'])

        # For product sections: be very strict, only use validated images + algorithmic from source
        if is_product_section:
            final_images = validated_images.copy()
            # Fill with best scoring images from source pages
            for img_path in best_images:
                if img_path not in final_images and len(final_images) < target_count:
                    final_images.append(img_path)
            section['images'] = final_images[:target_count]
        else:
            # Non-product sections: merge LLM and algorithmic picks
            final_images = []
            for img_path in validated_images:
                if img_path in [i['path'] for i in scored_images[:target_count * 2]]:
                    final_images.append(img_path)

            for img_path in best_images:
                if img_path not in final_images and len(final_images) < target_count:
                    final_images.append(img_path)

            section['images'] = final_images[:target_count]

        return section

    # =========================================================================
    # MAIN PROCESS
    # =========================================================================
    def process(self, analysis_path: str, output_path: str = None) -> Dict:
        """Main processing method - orchestrates all stages"""

        print("Loading analysis...")
        data = self.load_analysis_json(analysis_path)

        print("Filtering small images...")
        data = self.filter_small_images(data)

        # Build image index
        print("Building image index...")
        page_image_index = self.build_page_image_index(data)

        # Stage 1: Analyze themes
        print("\n[STAGE 1] Analyzing document themes...")
        themes = self.analyze_document_themes(data)
        if not themes:
            return {"error": "Failed to analyze document themes"}

        print(f"  Found {len(themes.get('themes', []))} themes")

        # Stage 2: Create structure
        print("\n[STAGE 2] Creating presentation structure...")
        sections = self.create_presentation_structure(themes, data)
        if not sections:
            return {"error": "Failed to create presentation structure"}

        print(f"  Created {len(sections)} sections")

        # Stage 3 & 4: Generate content for each section
        print(f"\n[STAGE 3] Generating section content...")
        generated_sections = []

        for i, section in enumerate(sections):
            print(f"  Section {i+1}/{len(sections)}: {section.get('title', 'Untitled')}")

            content = self.generate_section_content(section, data, page_image_index)

            if content:
                # Stage 5: Validate image bindings
                content = self.validate_image_bindings(content, page_image_index)

                # Stage 6: Enhance image matching
                content = self.enhance_image_matching(content, page_image_index)

                generated_sections.append(content)
            else:
                print(f"    Warning: Failed to generate content for section {i+1}")

        # Build final presentation
        presentation = {
            "title": themes.get('document_title', 'Presentation'),
            "document_type": themes.get('document_type', 'Unknown'),
            "sections": generated_sections,
            "_metadata": {
                "total_pages": len(data),
                "total_images_available": sum(len(page_image_index.get(p['page_num']+1, [])) for p in data),
                "total_sections": len(generated_sections),
                "images_used": len(set(img for s in generated_sections for img in s.get('images', []))),
                "themes_identified": len(themes.get('themes', []))
            }
        }

        # Save output
        if output_path:
            with open(output_path, "w", encoding="utf-8") as f:
                json.dump(presentation, f, indent=2, ensure_ascii=False)
            print(f"\nSaved to: {output_path}")

        return presentation


def main():
    import sys

    if len(sys.argv) < 2:
        print("Usage: python presentation_generator.py <analysis_json> [output_path]")
        sys.exit(1)

    analysis_path = sys.argv[1]
    output_path = sys.argv[2] if len(sys.argv) > 2 else "presentation.json"

    generator = PresentationGenerator()
    result = generator.process(analysis_path, output_path)

    if 'error' not in result:
        print("\n" + "="*50)
        print("PRESENTATION SUMMARY")
        print("="*50)
        meta = result['_metadata']
        print(f"  Title: {result['title']}")
        print(f"  Sections: {meta['total_sections']}")
        print(f"  Images used: {meta['images_used']} / {meta['total_images_available']}")
        print(f"  Themes identified: {meta['themes_identified']}")


if __name__ == "__main__":
    main()
