import flask
from flask import Flask, render_template, request, jsonify, send_file
import fitz  # PyMuPDF
from PIL import Image
import os
import platform # Keep for os-specific logic if any remains, but mostly web context
import io
import zipfile
import uuid
import time

app = Flask(__name__)

# --- Configuration (from your class, adapted) ---
# Autonomous Splitting Parameters (can be made configurable via UI later if needed)
LEFT_SCAN_X_START = 500
LEFT_SCAN_X_END = 600
RIGHT_SCAN_X_START = 250
RIGHT_SCAN_X_END = 350
BLACK_THRESHOLD = 50
DEFAULT_SPLIT_OFFSET = 28
MATH_SPLIT_OFFSET = 200
MIN_JUMP_DISTANCE = 300
HEADING_SCAN_LOOKAHEAD = 300
HEADING_SCAN_X_START = 400
HEADING_SCAN_X_END = 600
HEADING_COLORS = [
    {'name': 'blue', 'r_max': 80, 'g_min': 100, 'b_min': 150},
    {'name': 'pink', 'r_max': 255, 'g_min': 50, 'b_min': 150, 'g_max': 150, 'r_min': 180},
    {'name': 'green', 'r_max': 80, 'g_min': 120, 'b_min': 50, 'b_max': 120}
]

TEMP_UPLOAD_FOLDER = 'temp_uploads'
TEMP_PROCESSED_FOLDER = 'temp_processed'
os.makedirs(TEMP_UPLOAD_FOLDER, exist_ok=True)
os.makedirs(TEMP_PROCESSED_FOLDER, exist_ok=True)

# --- Helper Functions (adapted from your class methods) ---

def parse_page_range(range_str):
    pages = set()
    if not range_str: return []
    try:
        for part in range_str.split(','):
            part = part.strip()
            if '-' in part:
                start, end = map(int, part.split('-'))
                if start <= 0 or end < start: raise ValueError("Invalid page numbers in range.")
                pages.update(range(start - 1, end)) # 0-indexed
            else:
                page_num = int(part)
                if page_num <= 0: raise ValueError("Page numbers must be positive.")
                pages.add(page_num - 1) # 0-indexed
        return sorted(list(pages))
    except ValueError as e:
        app.logger.error(f"Page range parsing error: {e} for input '{range_str}'")
        raise # Re-raise to be caught by the route
        
def process_pdf_to_long_image(pdf_path, page_indices):
    doc = fitz.open(pdf_path)
    image_halves = []
    image_boundaries = [] # To store y-boundaries of each half-page in the long image
    dpi = 200 # Fixed DPI for consistency
    mat = fitz.Matrix(dpi / 72, dpi / 72)

    for page_index in page_indices:
        if 0 <= page_index < len(doc):
            page = doc.load_page(page_index)
            pix = page.get_pixmap(matrix=mat)
            img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
            width, height = img.size
            midpoint = width // 2
            image_halves.append({'img': img.crop((0, 0, midpoint, height)), 'type': 'left'})
            image_halves.append({'img': img.crop((midpoint, 0, width, height)), 'type': 'right'})
    doc.close()

    if not image_halves:
        return None, None

    total_height = sum(entry['img'].height for entry in image_halves)
    max_width = max(entry['img'].width for entry in image_halves)
    
    long_image_pil = Image.new('RGB', (max_width, total_height))
    current_y = 0
    for i, entry in enumerate(image_halves):
        img_half = entry['img']
        long_image_pil.paste(img_half, (0, current_y))
        boundary_info = {'start': current_y, 'end': current_y + img_half.height, 'type': entry['type']}
        image_boundaries.append(boundary_info)
        current_y += img_half.height
        
    return long_image_pil, image_boundaries

def _scan_for_heading_line(pixels, y_start, height, width): # Added width parameter
    y_end = min(y_start + HEADING_SCAN_LOOKAHEAD, height)
    # Ensure scan X range is within image bounds
    scan_x_start_eff = min(HEADING_SCAN_X_START, width - 1)
    scan_x_end_eff = min(HEADING_SCAN_X_END, width)

    for y_scan in range(y_start, y_end):
        for x_scan in range(scan_x_start_eff, scan_x_end_eff):
            r, g, b = pixels[x_scan, y_scan]
            for color_def in HEADING_COLORS:
                r_check = (color_def.get('r_min', 0) <= r <= color_def.get('r_max', 255))
                g_check = (color_def.get('g_min', 0) <= g <= color_def.get('g_max', 255))
                b_check = (color_def.get('b_min', 0) <= b <= color_def.get('b_max', 255))
                if r_check and g_check and b_check:
                    return y_scan, color_def['name']
    return None, None

def perform_auto_split(long_image_pil, image_boundaries, math_mode_enabled):
    split_lines_real = []
    if not long_image_pil or not image_boundaries:
        return []

    pixels = long_image_pil.load()
    width, height = long_image_pil.size
    split_offset = MATH_SPLIT_OFFSET if math_mode_enabled else DEFAULT_SPLIT_OFFSET

    for i, boundary in enumerate(image_boundaries):
        is_first_right_image = (i == 1) # First right image is at index 1 (0 is first left)
        found_split_in_first_right_image = False
        
        scan_x_start_boundary = LEFT_SCAN_X_START if boundary['type'] == 'left' else RIGHT_SCAN_X_START
        scan_x_end_boundary = LEFT_SCAN_X_END if boundary['type'] == 'left' else RIGHT_SCAN_X_END

        # Ensure scan region is within image width
        scan_x_start = min(scan_x_start_boundary, width -1)
        scan_x_end = min(scan_x_end_boundary, width)
        
        if scan_x_start >= scan_x_end: # Skip if scan region is invalid
            app.logger.warning(f"Skipping scan for image part {i} due to invalid scan X-range ({scan_x_start}-{scan_x_end}) for image width {width}")
            continue

        y = boundary['start']
        while y < boundary['end']:
            found_in_scan_strip = False
            for x in range(scan_x_start, scan_x_end):
                if y >= height: break # Should not happen if boundary['end'] is correct
                
                r, g, b = pixels[x, y]
                if r < BLACK_THRESHOLD and g < BLACK_THRESHOLD and b < BLACK_THRESHOLD:
                    if boundary['type'] == 'left':
                        heading_y, color_name = _scan_for_heading_line(pixels, y, height, width)
                        if heading_y is not None:
                            y = heading_y + 1 
                            found_in_scan_strip = True; break
                        else:
                            split_point = y - split_offset
                            if split_point > boundary['start']: # Ensure split is within current part
                                split_lines_real.append(split_point)
                            y += MIN_JUMP_DISTANCE
                            found_in_scan_strip = True; break
                    else:  # Right page logic
                        if is_first_right_image and not found_split_in_first_right_image:
                            found_split_in_first_right_image = True
                            # Potentially jump a bit to avoid re-detecting same spot or a header
                            y += MIN_JUMP_DISTANCE // 2 # Smaller jump for this specific ignore
                            found_in_scan_strip = True; break 
                        else:
                            split_point = y - split_offset
                            if split_point > boundary['start']: # Ensure split is within current part
                                split_lines_real.append(split_point)
                            y += MIN_JUMP_DISTANCE
                            found_in_scan_strip = True; break
            if not found_in_scan_strip:
                y += 1
                
    split_lines_real = sorted(list(set(sl for sl in split_lines_real if sl > 0))) # Unique, positive, sorted
    return split_lines_real

# --- Flask Routes ---
@app.route('/')
def index():
    # Clean up old files
    for folder in [TEMP_UPLOAD_FOLDER, TEMP_PROCESSED_FOLDER]:
        for f_name in os.listdir(folder):
            f_path = os.path.join(folder, f_name)
            if os.path.isfile(f_path) and (time.time() - os.path.getmtime(f_path) > 3600): # Older than 1 hour
                try:
                    os.remove(f_path)
                except Exception as e:
                    app.logger.error(f"Error deleting old file {f_path}: {e}")
    return render_template('index.html')

@app.route('/process_pdf', methods=['POST'])
def process_pdf_route():
    if 'pdf_file' not in request.files:
        return jsonify({'error': 'No PDF file provided'}), 400
    
    pdf_file = request.files['pdf_file']
    page_range_str = request.form.get('page_range', '')
    
    if pdf_file.filename == '':
        return jsonify({'error': 'No PDF file selected'}), 400

    if not pdf_file.filename.lower().endswith('.pdf'):
        return jsonify({'error': 'Invalid file type. Please upload a PDF.'}), 400

    try:
        page_indices = parse_page_range(page_range_str)
        if not page_indices and page_range_str: # If range_str was provided but parsing failed or resulted in empty
             return jsonify({'error': f"Invalid page range: '{page_range_str}'. Example: 1-5, 7, 9-10"}), 400
        if not page_indices and not page_range_str: # No range provided, process all pages
            # Need to open doc first to get page count if processing all
            temp_pdf_path_for_count = os.path.join(TEMP_UPLOAD_FOLDER, f"temp_{uuid.uuid4().hex}.pdf")
            pdf_file.save(temp_pdf_path_for_count)
            pdf_file.seek(0) # Reset stream position
            doc_for_count = fitz.open(temp_pdf_path_for_count)
            page_indices = list(range(doc_for_count.page_count))
            doc_for_count.close()
            os.remove(temp_pdf_path_for_count) # Clean up temp file for count
            if not page_indices:
                 return jsonify({'error': 'PDF has no pages or page range is effectively empty.'}), 400
        
    except ValueError as e:
        return jsonify({'error': str(e)}), 400

    filename = f"{uuid.uuid4().hex}.pdf"
    pdf_path = os.path.join(TEMP_UPLOAD_FOLDER, filename)
    pdf_file.save(pdf_path)

    try:
        long_image_pil, image_boundaries = process_pdf_to_long_image(pdf_path, page_indices)
        if not long_image_pil:
            os.remove(pdf_path)
            return jsonify({'error': 'No valid pages could be processed from the PDF.'}), 400

        processed_image_filename = f"{uuid.uuid4().hex}.png"
        processed_image_path = os.path.join(TEMP_PROCESSED_FOLDER, processed_image_filename)
        long_image_pil.save(processed_image_path)
        
        # Save image boundaries for auto-split to avoid reprocessing PDF
        boundaries_filename = f"{uuid.uuid4().hex}.json"
        boundaries_path = os.path.join(TEMP_PROCESSED_FOLDER, boundaries_filename)
        import json
        with open(boundaries_path, 'w') as f:
            json.dump(image_boundaries, f)

        os.remove(pdf_path) # Clean up uploaded PDF

        return jsonify({
            'message': 'PDF processed successfully',
            'image_url': f'/get_image/{processed_image_filename}',
            'image_id': processed_image_filename, # ID to reference the image later
            'boundaries_id': boundaries_filename, # ID for boundaries
            'width': long_image_pil.width,
            'height': long_image_pil.height
        })
    except Exception as e:
        app.logger.error(f"Error processing PDF: {e}", exc_info=True)
        if os.path.exists(pdf_path): os.remove(pdf_path)
        return jsonify({'error': f'An internal error occurred: {e}'}), 500


@app.route('/get_image/<filename>')
def get_image(filename):
    # Basic security: prevent path traversal
    if '..' in filename or filename.startswith('/'):
        return "Invalid filename", 400
    return send_file(os.path.join(TEMP_PROCESSED_FOLDER, filename), mimetype='image/png')

@app.route('/auto_split', methods=['POST'])
def auto_split_route():
    data = request.get_json()
    image_id = data.get('image_id')
    boundaries_id = data.get('boundaries_id')
    math_mode = data.get('math_mode', False)

    if not image_id or not boundaries_id:
        return jsonify({'error': 'Image ID or Boundaries ID not provided'}), 400

    image_path = os.path.join(TEMP_PROCESSED_FOLDER, image_id)
    boundaries_path = os.path.join(TEMP_PROCESSED_FOLDER, boundaries_id)

    if not os.path.exists(image_path) or not os.path.exists(boundaries_path):
        return jsonify({'error': 'Processed image or boundaries not found. Please process PDF again.'}), 404
        
    try:
        long_image_pil = Image.open(image_path)
        import json
        with open(boundaries_path, 'r') as f:
            image_boundaries = json.load(f)
            
        split_lines = perform_auto_split(long_image_pil, image_boundaries, math_mode)
        return jsonify({'split_lines': split_lines})
    except Exception as e:
        app.logger.error(f"Error during auto-split: {e}", exc_info=True)
        return jsonify({'error': f'An internal error occurred during auto-split: {e}'}), 500

@app.route('/save_splits', methods=['POST'])
def save_splits_route():
    data = request.get_json()
    image_id = data.get('image_id')
    split_lines_real = data.get('split_lines', [])
    output_folder_name = data.get('folder_name', 'pdf_slices').strip()

    if not output_folder_name: # Default if empty or whitespace
        output_folder_name = 'pdf_slices'
    # Sanitize folder_name to be a valid zip filename component
    output_folder_name = "".join(c if c.isalnum() or c in (' ', '_', '-') else '_' for c in output_folder_name).rstrip()
    if not output_folder_name: # If sanitization results in empty, use default
        output_folder_name = 'pdf_slices'


    if not image_id:
        return jsonify({'error': 'Image ID not provided'}), 400
    
    image_path = os.path.join(TEMP_PROCESSED_FOLDER, image_id)
    if not os.path.exists(image_path):
        return jsonify({'error': 'Processed image not found. Please process PDF again.'}), 404

    if not split_lines_real:
        return jsonify({'error': 'No split lines provided.'}), 400

    try:
        long_image_pil = Image.open(image_path)
        
        # Ensure split lines are numbers and sorted
        split_lines_real = sorted([float(sl) for sl in split_lines_real])

        boundaries = [0.0] + split_lines_real + [float(long_image_pil.height)] # Add start and end
        boundaries = sorted(list(set(boundaries))) # Ensure unique and sorted

        if len(boundaries) < 2:
             return jsonify({'error': 'Not enough distinct split points to create images.'}), 400

        zip_buffer = io.BytesIO()
        with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zf:
            num_saved = 0
            for i in range(len(boundaries) - 1):
                y_start = int(boundaries[i])
                y_end = int(boundaries[i+1])

                if y_end <= y_start: # Skip zero or negative height crops
                    continue
                
                # Ensure crop box is within image dimensions
                crop_y_start = max(0, y_start)
                crop_y_end = min(long_image_pil.height, y_end)
                crop_x_start = 0
                crop_x_end = long_image_pil.width

                if crop_y_end <= crop_y_start: # Still possible if original y_start was > height
                    continue

                crop_box = (crop_x_start, crop_y_start, crop_x_end, crop_y_end)
                
                try:
                    split_image_pil = long_image_pil.crop(crop_box)
                except Exception as crop_e:
                    app.logger.error(f"Error cropping image for q{num_saved+1} with box {crop_box}: {crop_e}")
                    continue # Skip this problematic crop

                if split_image_pil.height == 0 or split_image_pil.width == 0:
                    continue # Skip empty images

                img_byte_arr = io.BytesIO()
                split_image_pil.save(img_byte_arr, format='PNG', compress_level=4)
                img_byte_arr.seek(0)
                
                zf.writestr(f"q{num_saved+1}.png", img_byte_arr.getvalue())
                num_saved += 1
        
        zip_buffer.seek(0)
        
        if num_saved == 0:
            return jsonify({'error': 'No images were generated. Check split points.'}), 400

        return send_file(
            zip_buffer,
            as_attachment=True,
            download_name=f'{output_folder_name}.zip',
            mimetype='application/zip'
        )

    except Exception as e:
        app.logger.error(f"Error saving splits: {e}", exc_info=True)
        return jsonify({'error': f'An internal error occurred during saving: {e}'}), 500

if __name__ == '__main__':
    app.run(debug=True) # Set debug=False for production