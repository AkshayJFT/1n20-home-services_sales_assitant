"""
PDF to Presentation Pipeline

Uses:
- OpenRouter Qwen VL for page analysis (coordinates + description)
- OpenCV for image extraction
- Groq LLama for presentation generation

Usage:
    python main.py <pdf_path> [output_dir]
"""

import os
import sys
import json

from pdf_analyzer import PDFAnalyzer
from presentation_generator import PresentationGenerator


def run_pipeline(pdf_path: str, output_dir: str = "output"):
    """Run complete pipeline"""

    print("=" * 60)
    print("PDF TO PRESENTATION PIPELINE")
    print("=" * 60)
    print(f"\nPDF: {pdf_path}")
    print(f"Output: {output_dir}")

    os.makedirs(output_dir, exist_ok=True)

    # Step 1: Analyze PDF with Qwen VL
    print("\n" + "=" * 60)
    print("STEP 1: PDF Analysis (Qwen VL + OpenCV)")
    print("=" * 60)

    analyzer = PDFAnalyzer()
    results = analyzer.process_pdf(pdf_path, output_dir)

    analysis_path = os.path.join(output_dir, "analysis_results.json")

    # Step 2: Generate Presentation
    print("\n" + "=" * 60)
    print("STEP 2: Presentation Generation (Groq LLama)")
    print("=" * 60)

    generator = PresentationGenerator()
    presentation_path = os.path.join(output_dir, "presentation.json")
    presentation = generator.process(analysis_path, presentation_path)

    # Summary
    print("\n" + "=" * 60)
    print("PIPELINE COMPLETE")
    print("=" * 60)

    print(f"\nOutput files:")
    print(f"  Images: {os.path.join(output_dir, 'images')}")
    print(f"  Analysis: {analysis_path}")
    print(f"  Presentation: {presentation_path}")

    if 'error' not in presentation:
        meta = presentation.get('_metadata', {})
        print(f"\nSummary:")
        print(f"  Pages processed: {meta.get('total_pages', 'N/A')}")
        print(f"  Images available: {meta.get('total_images_available', 'N/A')}")
        print(f"  Images used: {meta.get('images_used', 'N/A')}")
        print(f"  Sections: {meta.get('overview_sections', 0) + meta.get('feature_sections', 0)}")

    return results, presentation


def analyze_only(pdf_path: str, output_dir: str = "output"):
    """Run only PDF analysis (no presentation)"""

    print("=" * 60)
    print("PDF ANALYSIS ONLY")
    print("=" * 60)

    os.makedirs(output_dir, exist_ok=True)

    analyzer = PDFAnalyzer()
    results = analyzer.process_pdf(pdf_path, output_dir)

    return results


def presentation_only(analysis_path: str, output_path: str = "presentation.json"):
    """Generate presentation from existing analysis"""

    print("=" * 60)
    print("PRESENTATION GENERATION ONLY")
    print("=" * 60)

    generator = PresentationGenerator()
    presentation = generator.process(analysis_path, output_path)

    return presentation


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        print("\nCommands:")
        print("  Full pipeline:      python main.py <pdf_path> [output_dir]")
        print("  Analysis only:      python main.py --analyze <pdf_path> [output_dir]")
        print("  Presentation only:  python main.py --present <analysis.json> [output.json]")
        sys.exit(1)

    if sys.argv[1] == "--analyze":
        if len(sys.argv) < 3:
            print("Error: Provide PDF path")
            sys.exit(1)
        pdf = sys.argv[2]
        out = sys.argv[3] if len(sys.argv) > 3 else "output"
        analyze_only(pdf, out)

    elif sys.argv[1] == "--present":
        if len(sys.argv) < 3:
            print("Error: Provide analysis JSON path")
            sys.exit(1)
        analysis = sys.argv[2]
        out = sys.argv[3] if len(sys.argv) > 3 else "presentation.json"
        presentation_only(analysis, out)

    else:
        pdf = sys.argv[1]
        out = sys.argv[2] if len(sys.argv) > 2 else "output"

        if not os.path.exists(pdf):
            print(f"Error: PDF not found: {pdf}")
            sys.exit(1)

        run_pipeline(pdf, out)
