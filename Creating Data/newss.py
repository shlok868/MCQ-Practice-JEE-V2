import tkinter
from tkinter import filedialog, messagebox, Canvas
import customtkinter as ctk
from PIL import Image, ImageTk
import fitz  # PyMuPDF
import os
import platform

# --- App Configuration ---
ctk.set_appearance_mode("System")
ctk.set_default_color_theme("blue")

class PDFSlicerApp:
    def __init__(self, root):
        self.root = root
        self.root.title("PDF Intelligent Auto-Slicer v5.3 (Responsive Zoom)") # Updated version
        self.root.geometry("1200x800")
        # --- State Variables ---
        self.pdf_path = None
        self.long_image_pil = None
        self.long_image_tk = None
        self.split_lines_real = []
        self.image_boundaries = []
        self.display_scale_factor = 1.0
        self.resize_job = None
        self.os_platform = platform.system()
        # Smooth Zooming
        self.zoom_level = 1.0
        self.min_zoom = 0.1
        self.max_zoom = 8.0
        self.zoom_job = None  # Debounced zoom event
        # Drag and Drop & Delete
        self.hovered_line_index = None
        self.dragging_line_index = None
        self.DRAG_SENSITIVITY = 7
        # Math Mode
        self.math_mode_enabled = False
        # Autonomous Splitting Parameters
        self.LEFT_SCAN_X_START = 500
        self.LEFT_SCAN_X_END = 600
        self.RIGHT_SCAN_X_START = 250
        self.RIGHT_SCAN_X_END = 350
        self.BLACK_THRESHOLD = 50
        self.DEFAULT_SPLIT_OFFSET = 28
        self.MATH_SPLIT_OFFSET = 200
        self.MIN_JUMP_DISTANCE = 300
        self.HEADING_SCAN_LOOKAHEAD = 300
        self.HEADING_SCAN_X_START = 400
        self.HEADING_SCAN_X_END = 600
        self.HEADING_COLORS = [
            {'name': 'blue', 'r_max': 80, 'g_min': 100, 'b_min': 150},
            {'name': 'pink', 'r_max': 255, 'g_min': 50, 'b_min': 150, 'g_max': 150, 'r_min': 180},
            {'name': 'green', 'r_max': 80, 'g_min': 120, 'b_min': 50, 'b_max': 120}
        ]
        # --- UI Structure ---
        self.root.grid_columnconfigure(0, weight=1)
        self.root.grid_rowconfigure(1, weight=1)
        self.top_frame = ctk.CTkFrame(self.root, corner_radius=10)
        self.top_frame.grid(row=0, column=0, padx=10, pady=10, sticky="new")
        self.top_frame.grid_columnconfigure((1, 4), weight=1)
        self.image_display_frame = ctk.CTkFrame(self.root, corner_radius=10)
        self.image_display_frame.grid(row=1, column=0, padx=10, pady=(0, 10), sticky="nsew")
        self.image_display_frame.grid_rowconfigure(0, weight=1)
        self.image_display_frame.grid_columnconfigure(0, weight=1)
        self._create_control_widgets()
        self._create_image_canvas()
        self._create_coord_display()
        self.image_display_frame.bind('<Configure>', self.on_window_resize)

    def _create_control_widgets(self):
        # Row 0
        self.select_pdf_button = ctk.CTkButton(self.top_frame, text="1. Select PDF", command=self.select_pdf)
        self.select_pdf_button.grid(row=0, column=0, padx=10, pady=5)
        self.pdf_path_label = ctk.CTkLabel(self.top_frame, text="No PDF selected", text_color="gray", anchor="w")
        self.pdf_path_label.grid(row=0, column=1, columnspan=5, padx=10, pady=5, sticky="ew")
        # Row 1
        self.page_range_label = ctk.CTkLabel(self.top_frame, text="Page Range:")
        self.page_range_label.grid(row=1, column=0, padx=10, pady=5)
        self.page_range_entry = ctk.CTkEntry(self.top_frame, placeholder_text="e.g., 35-40")
        self.page_range_entry.grid(row=1, column=1, padx=10, pady=5, sticky="ew")
        self.process_button = ctk.CTkButton(self.top_frame, text="2. Process", command=self.process_pdf)
        self.process_button.grid(row=1, column=2, padx=10, pady=5)
        self.auto_split_button = ctk.CTkButton(self.top_frame, text="3. Auto-Split", command=self.auto_split_image)
        self.auto_split_button.grid(row=1, column=3, padx=10, pady=5)
        self.split_save_button = ctk.CTkButton(self.top_frame, text="4. Save", command=self.split_and_save, state="disabled")
        self.split_save_button.grid(row=1, column=4, padx=10, pady=5)
        self.reset_button = ctk.CTkButton(self.top_frame, text="Reset", command=self.reset_all, state="disabled")
        self.reset_button.grid(row=1, column=5, padx=10, pady=5)
        self.math_mode_switch = ctk.CTkSwitch(self.top_frame, text="Math Mode", command=self._toggle_math_mode, onvalue=True, offvalue=False)
        self.math_mode_switch.grid(row=1, column=6, padx=20, pady=5)
        # Row 2
        self.folder_name_label = ctk.CTkLabel(self.top_frame, text="Save Folder:")
        self.folder_name_label.grid(row=2, column=0, padx=10, pady=5)
        self.folder_name_entry = ctk.CTkEntry(self.top_frame, placeholder_text="split_output")
        self.folder_name_entry.grid(row=2, column=1, padx=10, pady=5, sticky="ew")
        # Save location selection
        self.save_location_label = ctk.CTkLabel(self.top_frame, text="Save Location:")
        self.save_location_label.grid(row=2, column=2, padx=10, pady=5)
        self.save_location_entry = ctk.CTkEntry(self.top_frame, width=350)
        self.save_location_entry.grid(row=2, column=3, padx=10, pady=5, sticky="ew")
        self.save_location_entry.insert(0, r"C:\Users\IQ_mo\OneDrive\Documents\GitHub\MCQ-Practice-JEE - Copy\public\data")
        self.browse_save_btn = ctk.CTkButton(self.top_frame, text="Browse", command=self.browse_save_location)
        self.browse_save_btn.grid(row=2, column=4, padx=10, pady=5)
        # --- PART 2: Image Paste/Select and Process ---
        self.part2_frame = ctk.CTkFrame(self.root, corner_radius=10)
        self.part2_frame.grid(row=2, column=0, padx=10, pady=10, sticky="ew")
        self.part2_frame.grid_columnconfigure(1, weight=1)
        self.paste_label = ctk.CTkLabel(self.part2_frame, text="Paste or select image for Q/A extraction:")
        self.paste_label.grid(row=0, column=0, padx=10, pady=5, sticky="w")
        self.paste_btn = ctk.CTkButton(self.part2_frame, text="Paste from Clipboard", command=self.paste_image_from_clipboard)
        self.paste_btn.grid(row=0, column=1, padx=10, pady=5)
        self.select_img_btn = ctk.CTkButton(self.part2_frame, text="Select Image File", command=self.select_image_file)
        self.select_img_btn.grid(row=0, column=2, padx=10, pady=5)
        self.img_preview_label = ctk.CTkLabel(self.part2_frame, text="No image loaded", anchor="w")
        self.img_preview_label.grid(row=1, column=0, columnspan=3, padx=10, pady=5, sticky="ew")
        self.process_img_btn = ctk.CTkButton(self.part2_frame, text="Process Image", command=self.process_image_with_gemini)
        self.process_img_btn.grid(row=2, column=0, columnspan=3, padx=10, pady=5)
        self.pasted_image = None
        self.pasted_image_path = None

    def browse_save_location(self):
        path = filedialog.askdirectory(title="Select Save Location")
        if path:
            self.save_location_entry.delete(0, 'end')
            self.save_location_entry.insert(0, path)

    def _toggle_math_mode(self):
        self.math_mode_enabled = self.math_mode_switch.get()
        mode_text = "ON" if self.math_mode_enabled else "OFF"
        print(f"Math Mode is now {mode_text}. Split offset will be {self.MATH_SPLIT_OFFSET if self.math_mode_enabled else self.DEFAULT_SPLIT_OFFSET}px.")

    def _scan_for_heading_line(self, pixels, y_start, height):
        y_end = min(y_start + self.HEADING_SCAN_LOOKAHEAD, height)
        for y_scan in range(y_start, y_end):
            for x_scan in range(self.HEADING_SCAN_X_START, self.HEADING_SCAN_X_END):
                r, g, b = pixels[x_scan, y_scan]
                for color_def in self.HEADING_COLORS:
                    r_check = (color_def.get('r_min', 0) <= r <= color_def.get('r_max', 255))
                    g_check = (color_def.get('g_min', 0) <= g <= color_def.get('g_max', 255))
                    b_check = (color_def.get('b_min', 0) <= b <= color_def.get('b_max', 255))
                    if r_check and g_check and b_check:
                        return y_scan, color_def['name']
        return None, None

    def auto_split_image(self):
        if not self.long_image_pil or not self.image_boundaries:
            messagebox.showwarning("No Image", "Please process a PDF first.")
            return
        self.reset_clicks()  # Correctly reset only the lines, not the whole state.
        print("Starting intelligent auto-split process...")
        try:
            pixels = self.long_image_pil.load()
            width, height = self.long_image_pil.size
            split_offset = self.MATH_SPLIT_OFFSET if self.math_mode_enabled else self.DEFAULT_SPLIT_OFFSET
            print(f"Using split offset: {split_offset}px (Math Mode: {'ON' if self.math_mode_enabled else 'OFF'})")
            for i, boundary in enumerate(self.image_boundaries):
                is_first_right_image = (i == 1)
                found_split_in_first_right_image = False
                scan_x_start = self.LEFT_SCAN_X_START if boundary['type'] == 'left' else self.RIGHT_SCAN_X_START
                scan_x_end = self.LEFT_SCAN_X_END if boundary['type'] == 'left' else self.RIGHT_SCAN_X_END
                print(f"\nScanning image #{i} ({boundary['type']})")
                if scan_x_end > width:
                    messagebox.showerror("Scan Error", f"Scan region X={scan_x_end}px is wider than image ({width}px).")
                    return
                y = boundary['start']
                while y < boundary['end']:
                    found_in_scan_strip = False
                    for x in range(scan_x_start, scan_x_end):
                        if y >= height:
                            break
                        r, g, b = pixels[x, y]
                        if r < self.BLACK_THRESHOLD and g < self.BLACK_THRESHOLD and b < self.BLACK_THRESHOLD:
                            if boundary['type'] == 'left':
                                heading_y, color_name = self._scan_for_heading_line(pixels, y, height)
                                if heading_y is not None:
                                    print(f"  -> Black pixel at ({x},{y}), but '{color_name}' line found at y={heading_y}. IGNORING.")
                                    y = heading_y + 1
                                    found_in_scan_strip = True
                                    break
                                else:
                                    split_point = y - split_offset
                                    if split_point > 0:
                                        self.split_lines_real.append(split_point)
                                    print(f"  -> Black pixel at ({x}, {y}), no heading line. Placing split at y={split_point}.")
                                    y += self.MIN_JUMP_DISTANCE
                                    found_in_scan_strip = True
                                    break
                            else:  # Right page logic
                                if is_first_right_image and not found_split_in_first_right_image:
                                    print(f"  -> Black pixel at ({x},{y}) on first right image. IGNORING this one.")
                                    found_split_in_first_right_image = True
                                else:
                                    split_point = y - split_offset
                                    if split_point > 0:
                                        self.split_lines_real.append(split_point)
                                    print(f"  -> Black pixel at ({x}, {y}). Placing split at y={split_point}.")
                                y += self.MIN_JUMP_DISTANCE
                                found_in_scan_strip = True
                                break
                    if not found_in_scan_strip:
                        y += 1
            self.split_lines_real.sort()  # Ensure sorted after processing all parts
            print(f"\nAuto-split finished. Found {len(self.split_lines_real)} total questions.")
            self.redraw_split_lines()
            messagebox.showinfo("Auto-Split Complete", f"Found and marked {len(self.split_lines_real)} questions.")
        except Exception as e:
            messagebox.showerror("Auto-Split Error", f"An error occurred: {e}")

    def split_and_save(self):
        if not self.long_image_pil or not self.split_lines_real:
            messagebox.showwarning("Nothing to Split", "Please use 'Auto-Split' or click to create splits first.")
            return
        folder_name = self.folder_name_entry.get().strip() or "split_output"
        base_save_path = self.save_location_entry.get().strip() or r"C:\Users\IQ_mo\OneDrive\Documents\GitHub\MCQ-Practice-JEE - Copy\public\data"
        output_folder = os.path.join(base_save_path, folder_name)
        os.makedirs(output_folder, exist_ok=True)
        split_points = sorted(self.split_lines_real)
        boundaries = split_points + [self.long_image_pil.height]
        if len(boundaries) < 2:
            messagebox.showwarning("Not Enough Splits", "Need at least one split line to save a question.")
            return
        try:
            num_saved = 0
            for i in range(len(boundaries) - 1):
                y_start = boundaries[i]
                y_end = boundaries[i+1]
                if y_end <= y_start:
                    continue
                crop_box = (0, y_start, self.long_image_pil.width, y_end)
                split_image = self.long_image_pil.crop(crop_box)
                output_path = os.path.join(output_folder, f"q{i+1}.png")
                split_image.save(output_path, compress_level=4)
                print(f"Saved {output_path} with compression.")
                num_saved += 1
            messagebox.showinfo("Success!", f"{num_saved} images have been saved to '{output_folder}'.")
        except Exception as e:
            messagebox.showerror("Save Error", f"An error occurred while saving: {e}")

    def _on_mousewheel(self, event):
        is_ctrl_pressed = (event.state & 4) != 0
        if is_ctrl_pressed:
            zoom_factor = 1.2  # A slightly larger step feels better without animation
            if event.delta > 0 or event.num == 4:
                self.zoom_level *= zoom_factor
            elif event.delta < 0 or event.num == 5:
                self.zoom_level /= zoom_factor
            self.zoom_level = max(self.min_zoom, min(self.max_zoom, self.zoom_level))
            # Debouncing: cancel any pending zoom and schedule a new one
            if self.zoom_job:
                self.root.after_cancel(self.zoom_job)
            self.zoom_job = self.root.after(75, lambda e=event: self._perform_zoom(e))
        else:
            if self.os_platform == "Linux":
                if event.num == 4: self.canvas.yview_scroll(-1, "units")
                elif event.num == 5: self.canvas.yview_scroll(1, "units")
            else:
                scroll_val = -1 * (event.delta // 120) if self.os_platform == "Windows" else -1 * event.delta
                self.canvas.yview_scroll(scroll_val, "units")

    def _perform_zoom(self, event):
        """
        Actually performs the zoom. This is called by the debouncer in _on_mousewheel.
        """
        self.zoom_job = None
        self.update_image_display(zoom_event=event)

    def process_pdf(self):
        if not self.pdf_path:
            messagebox.showwarning("No PDF", "Please select a PDF file first.")
            return
        page_range_str = self.page_range_entry.get()
        page_indices = self.parse_page_range(page_range_str)
        if page_indices is None: return
        if not page_indices:
            messagebox.showwarning("No Pages", "Please enter a valid page range.")
            return
        self.reset_all()
        try:
            doc = fitz.open(self.pdf_path)
            image_halves = []
            dpi = 200
            mat = fitz.Matrix(dpi / 72, dpi / 72)
            for page_index in page_indices:
                if 0 <= page_index < len(doc):
                    page = doc.load_page(page_index)
                    pix = page.get_pixmap(matrix=mat)
                    img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
                    width, height = img.size
                    midpoint = width // 2
                    image_halves.append(img.crop((0, 0, midpoint, height)))
                    image_halves.append(img.crop((midpoint, 0, width, height)))
            doc.close()
            if not image_halves:
                messagebox.showerror("Error", "No valid pages could be processed.")
                return
            total_height = sum(img.height for img in image_halves)
            max_width = max(img.width for img in image_halves)
            self.long_image_pil = Image.new('RGB', (max_width, total_height))
            current_y = 0
            for i, img in enumerate(image_halves):
                self.long_image_pil.paste(img, (0, current_y))
                image_type = 'left' if i % 2 == 0 else 'right'
                boundary_info = {'start': current_y, 'end': current_y + img.height, 'type': image_type}
                self.image_boundaries.append(boundary_info)
                current_y += img.height
            self.update_image_display()
            self.split_save_button.configure(state="normal")
            self.reset_button.configure(state="normal")
        except Exception as e:
            messagebox.showerror("Processing Error", f"An error occurred: {e}")

    def reset_all(self):
        self.split_lines_real.clear()
        self.canvas.delete("split_line")
        self.dragging_line_index = None
        self.hovered_line_index = None
        self.canvas.config(cursor="")
        self.canvas.delete("all")
        self.long_image_pil = None
        self.long_image_tk = None
        self.split_save_button.configure(state="disabled")
        self.reset_button.configure(state="disabled")
        self.display_scale_factor = 1.0
        self.zoom_level = 1.0
        self.image_boundaries.clear()
        print("All states have been reset.")

    def reset_clicks(self):
        self.split_lines_real.clear()
        self.canvas.delete("split_line")
        self.dragging_line_index = None
        self.hovered_line_index = None
        self.canvas.config(cursor="")
        print("All split points have been reset.")

    def _create_coord_display(self):
        self.coord_frame = ctk.CTkFrame(self.image_display_frame, corner_radius=8)
        self.coord_label = ctk.CTkLabel(self.coord_frame, text="X: ---", font=("Segoe UI", 12))
        self.coord_label.pack(padx=10, pady=5)
        self.coord_frame.place(relx=1.0, rely=1.0, x=-15, y=-15, anchor="se")

    def _on_mouse_move(self, event):
        if self.long_image_pil is None: return
        x_on_canvas = self.canvas.canvasx(event.x)
        real_x = x_on_canvas * self.display_scale_factor
        if 0 <= real_x < self.long_image_pil.width:
            self.coord_label.configure(text=f"X: {int(real_x)} px")
        else:
            self.coord_label.configure(text="X: ---")
        if self.dragging_line_index is not None:
            return
        found_hover = False
        y_on_canvas = self.canvas.canvasy(event.y)
        for i, real_y in enumerate(self.split_lines_real):
            scaled_y = real_y / self.display_scale_factor
            if abs(y_on_canvas - scaled_y) < self.DRAG_SENSITIVITY:
                self.canvas.config(cursor="sb_v_double_arrow")
                self.hovered_line_index = i
                found_hover = True
                break
        if not found_hover:
            self.canvas.config(cursor="")
            self.hovered_line_index = None

    def _on_mouse_press(self, event):
        self.canvas.focus_set()
        if self.hovered_line_index is not None:
            self.dragging_line_index = self.hovered_line_index
            print(f"Started dragging line #{self.dragging_line_index}")
        else:
            y_on_canvas = self.canvas.canvasy(event.y)
            real_y = y_on_canvas * self.display_scale_factor
            self.split_lines_real.append(real_y)
            self.split_lines_real.sort()
            self.redraw_split_lines()
            print(f"Manual split point added at real y={real_y:.2f}")

    def _on_drag_motion(self, event):
        if self.dragging_line_index is None: return
        y_on_canvas = self.canvas.canvasy(event.y)
        new_real_y = y_on_canvas * self.display_scale_factor
        self.split_lines_real[self.dragging_line_index] = new_real_y
        self.redraw_split_lines()

    def _on_drag_release(self, event):
        if self.dragging_line_index is not None:
            print(f"Finished dragging line #{self.dragging_line_index}.")
            self.dragging_line_index = None
            self.split_lines_real.sort()
            self._on_mouse_move(event)

    def _on_delete_key(self, event):
        if self.hovered_line_index is not None and self.dragging_line_index is None:
            deleted_index = self.hovered_line_index
            print(f"Deleting line #{deleted_index} at y={self.split_lines_real[deleted_index]:.2f}")
            del self.split_lines_real[deleted_index]
            self.hovered_line_index = None
            self.canvas.config(cursor="")
            self.redraw_split_lines()

    def update_image_display(self, zoom_event=None):
        if self.long_image_pil is None: return
        canvas_width = self.image_display_frame.winfo_width()
        if canvas_width < 10: return
        orig_w, orig_h = self.long_image_pil.size
        if zoom_event:
            cursor_x_on_canvas = self.canvas.canvasx(zoom_event.x)
            cursor_y_on_canvas = self.canvas.canvasy(zoom_event.y)
            real_x_under_cursor = cursor_x_on_canvas * self.display_scale_factor
            real_y_under_cursor = cursor_y_on_canvas * self.display_scale_factor
        new_display_w = int(canvas_width * self.zoom_level)
        new_display_h = int(new_display_w * (orig_h / orig_w))
        self.display_scale_factor = orig_w / new_display_w if new_display_w > 0 else 1
        display_img = self.long_image_pil.resize((new_display_w, new_display_h), Image.Resampling.LANCZOS)
        self.long_image_tk = ImageTk.PhotoImage(display_img)
        self.canvas.delete("all")
        self.canvas.create_image(0, 0, anchor='nw', image=self.long_image_tk)
        self.canvas.configure(scrollregion=self.canvas.bbox("all"))
        self.redraw_split_lines()
        if zoom_event:
            new_x_on_canvas = real_x_under_cursor / self.display_scale_factor
            new_y_on_canvas = real_y_under_cursor / self.display_scale_factor
            scroll_to_x = new_x_on_canvas - zoom_event.x
            scroll_to_y = new_y_on_canvas - zoom_event.y
            self.canvas.xview_moveto(scroll_to_x / new_display_w if new_display_w > 0 else 0)
            self.canvas.yview_moveto(scroll_to_y / new_display_h if new_display_h > 0 else 0)

    def on_window_resize(self, event):
        if self.resize_job: self.root.after_cancel(self.resize_job)
        def _resize_action():
            self.zoom_level = 1.0
            self.update_image_display()
        self.resize_job = self.root.after(250, _resize_action)

    def redraw_split_lines(self):
        self.canvas.delete("split_line")
        if not self.long_image_tk: return
        line_width_on_canvas = self.long_image_tk.width()
        for real_y in self.split_lines_real:
            scaled_y = real_y / self.display_scale_factor
            self.canvas.create_line(0, scaled_y, line_width_on_canvas, scaled_y, fill="red", width=3, tags="split_line")

    def select_pdf(self):
        path = filedialog.askopenfilename(title="Select a PDF file", filetypes=[("PDF Files", "*.pdf")])
        if path:
            self.pdf_path = path
            display_path = "..." + path[-40:] if len(path) > 40 else path
            self.pdf_path_label.configure(text=display_path, text_color="white")

    def parse_page_range(self, range_str):
        pages = set()
        if not range_str: return []
        try:
            for part in range_str.split(','):
                part = part.strip()
                if '-' in part:
                    start, end = map(int, part.split('-'))
                    pages.update(range(start - 1, end))
                else:
                    pages.add(int(part) - 1)
            return sorted(list(pages))
        except ValueError:
            messagebox.showerror("Invalid Range", f"Could not parse page range: '{range_str}'.")
            return None

    def paste_image_from_clipboard(self):
        try:
            from PIL import ImageGrab
            img = ImageGrab.grabclipboard()
            if isinstance(img, Image.Image):
                self.pasted_image = img
                self.pasted_image_path = None
                self.img_preview_label.configure(text="Image loaded from clipboard.")
            else:
                self.img_preview_label.configure(text="No image in clipboard.")
        except Exception as e:
            self.img_preview_label.configure(text=f"Clipboard error: {e}")

    def select_image_file(self):
        path = filedialog.askopenfilename(title="Select an image file", filetypes=[("Image Files", "*.png;*.jpg;*.jpeg;*.bmp")])
        if path:
            try:
                img = Image.open(path)
                self.pasted_image = img
                self.pasted_image_path = path
                self.img_preview_label.configure(text=f"Loaded: {os.path.basename(path)}")
            except Exception as e:
                self.img_preview_label.configure(text=f"File error: {e}")

    def process_image_with_gemini(self):
        import base64
        import requests
        import json
        if self.pasted_image is None:
            messagebox.showwarning("No Image", "Paste or select an image first.")
            return
        # Convert image to base64
        from io import BytesIO
        buffered = BytesIO()
        self.pasted_image.save(buffered, format="PNG")
        img_b64 = base64.b64encode(buffered.getvalue()).decode()
        # Gemini 2.0 Flash API endpoint
        url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=AIzaSyAK67tGvTAb9Gsr0Qwb6hZKuGtNQ7Rc-LA"
        prompt = ("Extract questions and answers in json format. If applicable, replace a,b,c,d with 1,2,3,4. The format should be: \"1\":1, \"2\":3, and so on. In case of multiple answers, consider only the first one. "
                  "recheck the answers to make it very accurate")
        headers = {"Content-Type": "application/json"}
        data = {
            "contents": [
                {"parts": [
                    {"text": prompt},
                    {"inlineData": {"mimeType": "image/png", "data": img_b64}}
                ]}
            ]
        }
        self.img_preview_label.configure(text="Processing image with Gemini 2.0 Flash...")
        try:
            response = requests.post(url, headers=headers, data=json.dumps(data), timeout=60)
            if response.status_code == 200:
                result = response.json()
                # Try to extract the JSON from the model's text response
                text = result.get("candidates", [{}])[0].get("content", {}).get("parts", [{}])[0].get("text", "")
                # Try to parse JSON from the text
                try:
                    # If the model returns a code block, strip it
                    import re
                    json_str = re.sub(r'```json|```', '', text).strip()
                    qa_json = json.loads(json_str)
                except Exception:
                    qa_json = text  # fallback: save raw text
                # Save to ans.json in the chosen folder
                folder_name = self.folder_name_entry.get().strip() or "split_output"
                base_save_path = self.save_location_entry.get().strip() or r"C:\Users\IQ_mo\OneDrive\Documents\GitHub\MCQ-Practice-JEE - Copy\public\data"
                output_folder = os.path.join(base_save_path, folder_name)
                os.makedirs(output_folder, exist_ok=True)
                ans_path = os.path.join(output_folder, "ans.json")
                with open(ans_path, "w", encoding="utf-8") as f:
                    json.dump(qa_json, f, ensure_ascii=False, indent=2)
                self.img_preview_label.configure(text=f"Saved extracted Q/A to {ans_path}")
            else:
                self.img_preview_label.configure(text=f"Gemini API error: {response.status_code}")
        except Exception as e:
            self.img_preview_label.configure(text=f"Error: {e}")


    def _create_image_canvas(self):
        self.canvas = Canvas(self.image_display_frame, bg="#2B2B2B", highlightthickness=0)
        self.canvas.grid(row=0, column=0, sticky='nsew')
        self.v_scrollbar = ctk.CTkScrollbar(self.image_display_frame, command=self.canvas.yview)
        self.v_scrollbar.grid(row=0, column=1, sticky='ns')
        self.h_scrollbar = ctk.CTkScrollbar(self.image_display_frame, orientation="horizontal", command=self.canvas.xview)
        self.h_scrollbar.grid(row=1, column=0, sticky='ew')
        self.canvas.configure(yscrollcommand=self.v_scrollbar.set, xscrollcommand=self.h_scrollbar.set)
        self.canvas.bind("<MouseWheel>", self._on_mousewheel)
        self.canvas.bind("<Button-4>", self._on_mousewheel)
        self.canvas.bind("<Button-5>", self._on_mousewheel)
        self.canvas.bind("<Motion>", self._on_mouse_move)
        self.canvas.bind("<ButtonPress-1>", self._on_mouse_press)
        self.canvas.bind("<B1-Motion>", self._on_drag_motion)
        self.canvas.bind("<ButtonRelease-1>", self._on_drag_release)
        self.canvas.bind("<Delete>", self._on_delete_key)
        self.canvas.bind('<Configure>', lambda e: self.canvas.configure(scrollregion=self.canvas.bbox("all")))

# --- Main Application Execution ---
if __name__ == "__main__":
    app_root = ctk.CTk()
    app = PDFSlicerApp(app_root)
    app_root.mainloop()