document.addEventListener('DOMContentLoaded', () => {
    const pdfFileInput = document.getElementById('pdf_file');
    const pdfPathLabel = document.getElementById('pdf_path_label');
    const pageRangeInput = document.getElementById('page_range');
    const processButton = document.getElementById('process_button');
    const mathModeCheckbox = document.getElementById('math_mode');
    const autoSplitButton = document.getElementById('auto_split_button');
    const folderNameInput = document.getElementById('folder_name');
    const splitSaveButton = document.getElementById('split_save_button');
    const resetButton = document.getElementById('reset_button');
    const resetLinesButton = document.getElementById('reset_lines_button');
    
    const statusMessageDiv = document.getElementById('status_message');
    const coordDisplay = document.getElementById('coord_display');

    const canvas = document.getElementById('image_canvas');
    const ctx = canvas.getContext('2d');
    const imageDisplayContainer = document.querySelector('.image-display-container');

    let longImage = null; // Will hold the Image object
    let originalImageWidth = 0;
    let originalImageHeight = 0;
    let currentImageID = null; // Store ID from server for processed image
    let currentBoundariesID = null; // Store ID for boundaries file

    let splitLinesReal = []; // Stores Y-coordinates on the ORIGINAL image
    
    let zoomLevel = 1.0;
    const minZoom = 0.1;
    const maxZoom = 8.0;
    let panX = 0;
    let panY = 0;
    let isPanning = false;
    let lastPanX = 0;
    let lastPanY = 0;

    const DRAG_SENSITIVITY_CANVAS = 7; // pixels on canvas
    let hoveredLineIndex = null;
    let draggingLineIndex = null;

    // --- UI Update Functions ---
    function showStatus(message, type = 'info') { // type: 'info', 'success', 'error'
        statusMessageDiv.textContent = message;
        statusMessageDiv.className = `status ${type}`;
        if (type === 'error' || type === 'success') {
            setTimeout(() => statusMessageDiv.textContent = '', 5000);
        }
    }

    function updateButtonStates() {
        const hasImage = !!longImage;
        autoSplitButton.disabled = !hasImage;
        splitSaveButton.disabled = !hasImage || splitLinesReal.length === 0;
        resetLinesButton.disabled = !hasImage;
        processButton.disabled = !pdfFileInput.files[0];
    }

    // --- Canvas Drawing and Interaction ---
    functiondrawImage() {
        if (!longImage) return;

        // Fit canvas to container, respecting aspect ratio
        const containerWidth = imageDisplayContainer.clientWidth;
        const containerHeight = imageDisplayContainer.clientHeight;
        
        // Calculate the display size of the image with current zoom
        let displayWidth = originalImageWidth * zoomLevel;
        let displayHeight = originalImageHeight * zoomLevel;

        // Set canvas physical size to avoid blurriness, but visual size constrained by container
        canvas.width = displayWidth;
        canvas.height = displayHeight;
        
        // CSS to scale canvas if it's larger than container
        // This makes panning on a large zoomed image smoother.
        if (displayWidth > containerWidth || displayHeight > containerHeight) {
            canvas.style.width = displayWidth + "px";
            canvas.style.height = displayHeight + "px";
        } else {
            // Center smaller image if not panning
             canvas.style.width = displayWidth + "px";
             canvas.style.height = displayHeight + "px";
             // If not panning manually, center small image
             // For now, let's keep it simple and top-left aligned if smaller than container
        }
        
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        // Apply pan transformation BEFORE drawing image
        ctx.save();
        ctx.translate(panX, panY);
        ctx.drawImage(longImage, 0, 0, originalImageWidth, originalImageHeight); // Draw original image data
        
        // Draw split lines
        splitLinesReal.forEach((realY, index) => {
            const canvasY = realY; // Y is already in original image coords
            ctx.beginPath();
            ctx.moveTo(0, canvasY);
            ctx.lineTo(originalImageWidth, canvasY);
            ctx.lineWidth = hoveredLineIndex === index || draggingLineIndex === index ? 5 : 3;
            ctx.strokeStyle = hoveredLineIndex === index ? 'blue' : 'red';
            ctx.stroke();
        });
        ctx.restore(); // Restore transform for any UI elements drawn on top later
    }
    
    // Convert canvas event coords to image coords (considering pan and zoom)
    function getMousePosOnImage(event) {
        const rect = canvas.getBoundingClientRect(); // position of canvas on screen
        
        // mouse position relative to canvas top-left corner
        let canvasX = event.clientX - rect.left;
        let canvasY = event.clientY - rect.top;

        // The canvas element itself might be scaled by CSS if larger than its container.
        // We need to account for this scaling to get coordinates on the canvas's drawing surface.
        canvasX *= (canvas.width / rect.width);
        canvasY *= (canvas.height / rect.height);
        
        // Now, transform these canvas drawing surface coordinates to original image coordinates
        const imageX = (canvasX - panX) / zoomLevel;
        const imageY = (canvasY - panY) / zoomLevel;

        return { x: imageX, y: imageY };
    }


    canvas.addEventListener('wheel', (event) => {
        if (!longImage) return;
        event.preventDefault();

        if (event.ctrlKey) { // Zoom
            const { x: imgMouseX, y: imgMouseY } = getMousePosOnImage(event);
            
            const zoomFactor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
            const newZoomLevel = Math.max(minZoom, Math.min(maxZoom, zoomLevel * zoomFactor));

            // Adjust pan so the point under the mouse stays the same
            panX = panX * (newZoomLevel / zoomLevel) + imgMouseX * (newZoomLevel - zoomLevel);
            panY = panY * (newZoomLevel / zoomLevel) + imgMouseY * (newZoomLevel - zoomLevel);
            
            zoomLevel = newZoomLevel;

            drawImage();
        } else { // Scroll (Pan Y)
            panY -= event.deltaY * 0.5; // Adjust sensitivity as needed
            // Clamp panning
            const maxPanY = 0;
            const minPanY = Math.min(0, canvas.height - originalImageHeight * zoomLevel); // canvas.height is display height
            panY = Math.max(minPanY, Math.min(maxPanY, panY));
            drawImage();
        }
    });

    canvas.addEventListener('mousedown', (event) => {
        if (!longImage) return;
        const { x: imgMouseX, y: imgMouseY } = getMousePosOnImage(event);

        if (hoveredLineIndex !== null) {
            draggingLineIndex = hoveredLineIndex;
            canvas.style.cursor = 'grabbing';
        } else if (event.buttons === 1 && zoomLevel > 1) { // Pan with left click if zoomed
            isPanning = true;
            lastPanX = event.clientX;
            lastPanY = event.clientY;
            canvas.style.cursor = 'grabbing';
        } else if (event.buttons === 1) { // Add new line
            splitLinesReal.push(imgMouseY);
            splitLinesReal.sort((a, b) => a - b);
            drawImage();
            updateButtonStates();
        }
    });

    canvas.addEventListener('mousemove', (event) => {
        if (!longImage) return;
        const { x: imgMouseX, y: imgMouseY } = getMousePosOnImage(event);
        coordDisplay.textContent = `X: ${Math.round(imgMouseX)} Y: ${Math.round(imgMouseY)}`;

        if (isPanning) {
            const dx = event.clientX - lastPanX;
            const dy = event.clientY - lastPanY;
            panX += dx;
            panY += dy;
            lastPanX = event.clientX;
            lastPanY = event.clientY;
            
            // Clamp panning (simplified, needs adjustment based on actual display vs image size)
            // const maxPanX = 0;
            // const minPanX = Math.min(0, canvas.width - originalImageWidth * zoomLevel);
            // panX = Math.max(minPanX, Math.min(maxPanX, panX));

            // const maxPanY = 0;
            // const minPanY = Math.min(0, canvas.height - originalImageHeight * zoomLevel);
            // panY = Math.max(minPanY, Math.min(maxPanY, panY));

            drawImage();
            return;
        }
        
        if (draggingLineIndex !== null) {
            splitLinesReal[draggingLineIndex] = imgMouseY;
            // No sort while dragging, sort on release
            drawImage();
        } else {
            let oldHoveredLine = hoveredLineIndex;
            hoveredLineIndex = null;
            let minDistance = DRAG_SENSITIVITY_CANVAS / zoomLevel; // Sensitivity in image pixels

            splitLinesReal.forEach((realY, index) => {
                if (Math.abs(realY - imgMouseY) < minDistance) {
                    hoveredLineIndex = index;
                    minDistance = Math.abs(realY - imgMouseY); // Prioritize closer line
                }
            });

            if (hoveredLineIndex !== null) {
                canvas.style.cursor = 'ns-resize';
            } else if (zoomLevel > 1) {
                canvas.style.cursor = 'grab';
            } else {
                canvas.style.cursor = 'crosshair';
            }
            if (oldHoveredLine !== hoveredLineIndex) drawImage(); // Redraw if hover state changed
        }
    });

    canvas.addEventListener('mouseup', (event) => {
        if (isPanning) {
            isPanning = false;
            canvas.style.cursor = (zoomLevel > 1) ? 'grab' : 'crosshair';
        }
        if (draggingLineIndex !== null) {
            splitLinesReal.sort((a, b) => a - b);
            draggingLineIndex = null;
            canvas.style.cursor = 'crosshair'; // Re-evaluate cursor on next move
            drawImage();
        }
    });

    canvas.addEventListener('mouseleave', () => {
        coordDisplay.textContent = "X: --- Y: ---";
        if (!isPanning && !draggingLineIndex) { // Don't reset hover if actively dragging out
           // hoveredLineIndex = null; 
           // drawImage(); // if hover changed visually
        }
    });
    
    // Keyboard delete for lines
    // Canvas needs focus, or listen on document and check if canvas is active
    canvas.setAttribute('tabindex', '0'); // Make canvas focusable
    canvas.addEventListener('keydown', (event) => {
        if (event.key === 'Delete' || event.key === 'Backspace') {
            if (hoveredLineIndex !== null && draggingLineIndex === null) {
                event.preventDefault(); // Prevent browser back navigation on Backspace
                splitLinesReal.splice(hoveredLineIndex, 1);
                hoveredLineIndex = null;
                drawImage();
                updateButtonStates();
            }
        }
    });


    // --- API Call Functions ---
    pdfFileInput.addEventListener('change', () => {
        if (pdfFileInput.files.length > 0) {
            pdfPathLabel.textContent = pdfFileInput.files[0].name;
        } else {
            pdfPathLabel.textContent = 'No PDF selected';
        }
        updateButtonStates();
    });

    processButton.addEventListener('click', async () => {
        if (!pdfFileInput.files[0]) {
            showStatus('Please select a PDF file first.', 'error');
            return;
        }

        const formData = new FormData();
        formData.append('pdf_file', pdfFileInput.files[0]);
        formData.append('page_range', pageRangeInput.value);

        showStatus('Processing PDF...', 'info');
        processButton.disabled = true;

        try {
            const response = await fetch('/process_pdf', { method: 'POST', body: formData });
            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Failed to process PDF.');
            }
            
            resetCanvasAndLines(); // Clear previous state
            currentImageID = data.image_id;
            currentBoundariesID = data.boundaries_id;
            originalImageWidth = data.width;
            originalImageHeight = data.height;
            
            longImage = new Image();
            longImage.onload = () => {
                // Initial draw: fit to container width, or use natural size if smaller
                const containerWidth = imageDisplayContainer.clientWidth;
                if (originalImageWidth > containerWidth) {
                    zoomLevel = containerWidth / originalImageWidth;
                } else {
                    zoomLevel = 1.0; // Show at 100% if it fits
                }
                panX = 0; panY = 0; // Reset pan
                drawImage();
                showStatus('PDF processed. Image loaded.', 'success');
                updateButtonStates();
            };
            longImage.onerror = () => {
                showStatus('Error loading processed image.', 'error');
                longImage = null;
                updateButtonStates();
            }
            longImage.src = data.image_url + `?t=${new Date().getTime()}`; // Cache buster

        } catch (error) {
            showStatus(`Error: ${error.message}`, 'error');
            longImage = null; // Ensure cleanup on error
        } finally {
            processButton.disabled = false; // Re-enable regardless of outcome
            updateButtonStates();
        }
    });

    autoSplitButton.addEventListener('click', async () => {
        if (!currentImageID || !currentBoundariesID) {
            showStatus('No processed image available for auto-splitting.', 'error');
            return;
        }
        showStatus('Auto-splitting...', 'info');
        autoSplitButton.disabled = true;
        try {
            const response = await fetch('/auto_split', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    image_id: currentImageID,
                    boundaries_id: currentBoundariesID,
                    math_mode: mathModeCheckbox.checked 
                })
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Auto-split failed.');

            splitLinesReal = data.split_lines || [];
            splitLinesReal.sort((a, b) => a - b);
            drawImage();
            showStatus(`Auto-split complete. Found ${splitLinesReal.length} lines.`, 'success');
        } catch (error) {
            showStatus(`Auto-split error: ${error.message}`, 'error');
        } finally {
            autoSplitButton.disabled = false;
            updateButtonStates();
        }
    });

    splitSaveButton.addEventListener('click', async () => {
        if (!currentImageID || splitLinesReal.length === 0) {
            showStatus('No image processed or no split lines to save.', 'error');
            return;
        }
        
        const folderName = folderNameInput.value.trim() || 'pdf_slices';
        showStatus('Preparing images for download...', 'info');
        splitSaveButton.disabled = true;

        try {
            const response = await fetch('/save_splits', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    image_id: currentImageID,
                    split_lines: splitLinesReal,
                    folder_name: folderName
                })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to save splits.');
            }

            const blob = await response.blob();
            const downloadUrl = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = downloadUrl;
            // Get filename from Content-Disposition header or use default
            const disposition = response.headers.get('content-disposition');
            let filename = `${folderName}.zip`;
            if (disposition && disposition.indexOf('attachment') !== -1) {
                const filenameRegex = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/;
                const matches = filenameRegex.exec(disposition);
                if (matches != null && matches[1]) {
                  filename = matches[1].replace(/['"]/g, '');
                }
            }
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(downloadUrl);
            a.remove();
            showStatus('Images saved and download started.', 'success');

        } catch (error) {
            showStatus(`Save error: ${error.message}`, 'error');
        } finally {
            splitSaveButton.disabled = false; // Re-enable based on state by updateButtonStates
            updateButtonStates();
        }
    });

    function resetCanvasAndLines() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        longImage = null;
        originalImageWidth = 0;
        originalImageHeight = 0;
        currentImageID = null;
        currentBoundariesID = null;
        splitLinesReal = [];
        zoomLevel = 1.0;
        panX = 0;
        panY = 0;
        hoveredLineIndex = null;
        draggingLineIndex = null;
        canvas.style.width = 'auto'; // Reset CSS scaling
        canvas.style.height = 'auto';
        canvas.width = imageDisplayContainer.clientWidth; // Reset canvas drawing surface size
        canvas.height = imageDisplayContainer.clientHeight;
    }

    resetButton.addEventListener('click', () => {
        resetCanvasAndLines();
        pdfFileInput.value = ''; // Clear file input
        pdfPathLabel.textContent = 'No PDF selected';
        pageRangeInput.value = '';
        mathModeCheckbox.checked = false;
        folderNameInput.value = 'pdf_slices';
        showStatus('All states reset.', 'info');
        updateButtonStates();
    });

    resetLinesButton.addEventListener('click', () => {
        splitLinesReal = [];
        hoveredLineIndex = null;
        draggingLineIndex = null;
        drawImage(); // Redraw without lines
        updateButtonStates();
        showStatus('Split lines reset.', 'info');
    });
    
    // Initial setup
    updateButtonStates(); // Set initial disabled states
    // Resize canvas when container resizes (e.g. window resize)
    // Basic resize handling, might need debouncing for performance
    new ResizeObserver(() => {
        if(longImage) { // Only resize/redraw if an image is loaded
            // Reset zoom to fit, or maintain current zoom?
            // For simplicity, let's try to maintain current view if possible,
            // but a full re-fit might be better. Let's do a simple redraw.
             drawImage();
        } else {
            // If no image, ensure canvas fills container
            canvas.width = imageDisplayContainer.clientWidth;
            canvas.height = imageDisplayContainer.clientHeight;
        }
    }).observe(imageDisplayContainer);

});