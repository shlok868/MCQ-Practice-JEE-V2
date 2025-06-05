import os
import tkinter as tk
from tkinter import simpledialog, Entry, Button, Label, messagebox
from PIL import ImageGrab

class SnippingTool:
    def __init__(self, root):
        self.root = root
        self.root.title("Snipping Tool")

        self.folder_name_var = tk.StringVar()
        self.start_number_override = None # New variable to store manual override
        self.question_number = 1
        self.folder_path = ""

        self.create_main_window()

    def create_main_window(self):
        self.main_frame = tk.Frame(self.root)
        self.main_frame.pack(padx=20, pady=20)

        Label(self.main_frame, text="Enter Folder Name:").grid(row=0, column=0, pady=5, sticky="w")
        self.folder_name_entry = Entry(self.main_frame, textvariable=self.folder_name_var, width=40)
        self.folder_name_entry.grid(row=0, column=1, pady=5, padx=5)
        self.folder_name_entry.bind("<Return>", self.start_snipping_from_entry) # Allow pressing Enter

        self.start_button = Button(self.main_frame, text="Start Snipping", command=self.start_snipping_mode)
        self.start_button.grid(row=1, column=0, columnspan=2, pady=10)

        self.root.bind("<Escape>", self.exit_app) # Bind Escape key to exit

    def start_snipping_from_entry(self, event=None):
        """Called when Enter is pressed in the folder name entry."""
        self.start_snipping_mode()

    def start_snipping_mode(self):
        folder_name = self.folder_name_var.get().strip()
        if not folder_name:
            messagebox.showerror("Error", "Folder name cannot be empty!")
            return

        self.folder_path = os.path.join(os.getcwd(), folder_name) # Save to current working directory
        if not os.path.exists(self.folder_path):
            os.makedirs(self.folder_path)

        # Determine suggested next question number based on existing files
        suggested_start_number = 1
        existing_files = [f for f in os.listdir(self.folder_path) if f.startswith('q') and f.endswith('.png')]
        if existing_files:
            try:
                numbers = [int(f[1:-4]) for f in existing_files if f[1:-4].isdigit()]
                if numbers:
                    suggested_start_number = max(numbers) + 1
            except ValueError:
                # Fallback if filenames are not perfectly qX.png, keep default 1
                pass

        # Prompt user for starting question number, with suggestion
        manual_start_input = simpledialog.askstring(
            "Input",
            f"Enter the starting question number (suggested: {suggested_start_number}):",
            initialvalue=str(suggested_start_number)
        )

        if manual_start_input is None: # User clicked cancel
            return

        try:
            self.question_number = int(manual_start_input)
            if self.question_number <= 0:
                raise ValueError
        except ValueError:
            messagebox.showerror("Invalid Input", "Please enter a valid positive integer for the starting question number.")
            return

        self.root.withdraw() # Hide the main window
        self.show_snipping_overlay()


    def show_snipping_overlay(self):
        self.snipping_window = tk.Toplevel(self.root)
        self.snipping_window.attributes("-alpha", 0.3)  # Make the window semi-transparent
        self.snipping_window.attributes("-fullscreen", True)
        self.snipping_window.attributes("-topmost", True) # Keep on top
        self.snipping_window.attributes("-toolwindow", True) # Hides from taskbar (optional, but good for overlays)

        self.canvas = tk.Canvas(self.snipping_window, cursor="cross")
        self.canvas.pack(fill=tk.BOTH, expand=tk.YES)

        self.canvas.bind("<ButtonPress-1>", self.on_button_press)
        self.canvas.bind("<B1-Motion>", self.on_mouse_drag)
        self.canvas.bind("<ButtonRelease-1>", self.on_button_release)
        
        self.snipping_window.bind("<Escape>", self.pause_snipping) # Bind Escape to pause

        self.rect = None
        self.start_x = None
        self.start_y = None
        self.drag_initiated = False # Flag to track if a drag has started

    def on_button_press(self, event):
        self.start_x = event.x
        self.start_y = event.y
        # Create a tiny initial rectangle, it will be updated quickly on drag
        self.rect = self.canvas.create_rectangle(self.start_x, self.start_y, self.start_x + 1, self.start_y + 1, outline='red')
        self.drag_initiated = False # Reset for new click/drag sequence

    def on_mouse_drag(self, event):
        # A small threshold to determine if it's truly a drag, not just a tiny mouse tremor
        if abs(event.x - self.start_x) > 5 or abs(event.y - self.start_y) > 5:
            self.drag_initiated = True # Set flag if significant movement occurs
        
        if self.rect is None: # Should not happen if on_button_press worked
            return
        
        cur_x, cur_y = (event.x, event.y)
        self.canvas.coords(self.rect, self.start_x, self.start_y, cur_x, cur_y)

    def on_button_release(self, event):
        end_x, end_y = (event.x, event.y)

        # Always delete the rectangle, whether pausing or taking screenshot
        if self.rect:
            self.canvas.delete(self.rect)
            self.rect = None

        if not self.drag_initiated: # If no significant drag occurred, it's a single click
            self.pause_snipping()
            return

        # If it was a drag, proceed with screenshot
        self.snipping_window.withdraw() # Hide the snipping window temporarily

        x1 = min(self.start_x, end_x)
        y1 = min(self.start_y, end_y)
        x2 = max(self.start_x, end_x)
        y2 = max(self.start_y, end_y)

        self.take_screenshot(x1, y1, x2, y2)
        self.question_number += 1

        self.snipping_window.deiconify() # Show the snipping window again


    def pause_snipping(self, event=None):
        if hasattr(self, 'snipping_window') and self.snipping_window.winfo_exists():
            self.snipping_window.destroy() # Close the snipping window
        self.root.deiconify() # Bring back the main window

        # The self.question_number already holds the next sequential number after the last screenshot
        # or the manually set start number if no screenshots were taken yet.
        print(f"Snipping paused. Next question number will be: {self.question_number}")


    def take_screenshot(self, x1, y1, x2, y2):
        # Ensure coordinates are valid for ImageGrab (minimum 1x1 pixel)
        if abs(x2 - x1) < 1 or abs(y2 - y1) < 1:
            print("Selection too small for screenshot. Please drag to select an area.")
            messagebox.showwarning("Warning", "Selection too small for screenshot. Please drag to select a valid area.")
            return

        try:
            screenshot = ImageGrab.grab(bbox=(x1, y1, x2, y2))
            filename = os.path.join(self.folder_path, f"q{self.question_number}.png")
            screenshot.save(filename)
            print(f"Screenshot saved as {filename}")
        except Exception as e:
            print(f"Error taking screenshot: {e}")
            messagebox.showerror("Screenshot Error", f"Failed to save screenshot: {e}")

    def exit_app(self, event=None):
        if hasattr(self, 'snipping_window') and self.snipping_window.winfo_exists():
            self.snipping_window.destroy()
        self.root.destroy()

def main():
    root = tk.Tk()
    app = SnippingTool(root)
    root.mainloop()

if __name__ == "__main__":
    main()