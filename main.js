// Google Sheets API configuration for navigation data (READ-ONLY)
const sheetId = '1qhAdWx619ipzojc_VSYkzRxPZcl24EYBZwcQgES5IYA'; // Your Google Sheet ID for navigation
const apiKey = 'AIzaSyBXGeD_pvVofRm_u74BG5Rt-CBHNB-Fh2I';   // Your Google Sheets API Key (for read-only access)

// Use the same icon for all folders/exams
const folderIconUrl = "https://img.icons8.com/fluency/96/folder-invoices.png";
const examIconUrl = "https://img.icons8.com/fluency/96/test-passed.png";

let fullSheetData = []; // To store the entire fetched sheet data for navigation
let currentFolderContext = {
    path: [], // e.g., ["Physics Modules", "Electrostatics"] - current navigation path
    scanRow: 1, // The 1-indexed row number to scan for items at the current level
    startCol: 0, // 0-indexed column index where current branch starts
    endCol: 25 // 0-indexed column index where current branch ends (e.g., 25 for 'Z')
};

// Helper to convert 0-indexed column number to letter (0 -> A, 1 -> B, ...)
function colIndexToLetter(colIndex) {
    let letter = '';
    let temp = colIndex;
    while (temp >= 0) {
        letter = String.fromCharCode(65 + (temp % 26)) + letter;
        temp = Math.floor(temp / 26) - 1;
    }
    return letter;
}

// Helper to convert column letter to 0-indexed index (A -> 0, B -> 1, ...)
function colLetterToIndex(colLetter) {
    let index = 0;
    for (let i = 0; i < colLetter.length; i++) {
        index = index * 26 + (colLetter.charCodeAt(i) - 65 + 1);
    }
    return index - 1; // Convert to 0-indexed
}

/**
 * Fetches the entire relevant portion of the Google Sheet for navigation data.
 * This is done once on page load to minimize API calls during navigation.
 */
async function fetchNavigationData() {
    try {
        // Fetch a sufficiently large range to cover your entire navigation structure
        // Adjust 'Z500' if your sheet is wider or deeper
        const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/A1:Z500?key=${apiKey}&valueRenderOption=UNFORMATTED_VALUE`);
        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }
        const data = await response.json();
        fullSheetData = data.values || [];
        console.log("Full Sheet Navigation Data Fetched:", fullSheetData);
    } catch (error) {
        console.error("Error fetching navigation data from Google Sheet:", error);
        // Replaced alert with console.error as per previous instructions
        console.error("Failed to load navigation data. Check sheet ID, API key, and network."); 
    }
}

/**
 * Loads and renders folders/exams based on the current navigation path.
 * @param {string[]} pathArray - An array representing the current folder path (e.g., [], ["Physics"], ["Physics", "Module1"]).
 */
async function loadFolders(pathArray = []) {
    currentFolderContext.path = pathArray;
    currentFolderContext.scanRow = pathArray.length + 1; // Level 0 (root) scans Row 1, Level 1 scans Row 2, etc.

    // Determine the column boundaries for the current branch based on the parent folder
    let branchStartCol = 0;
    let branchEndCol = 25; // Default to max column 'Z' (0-indexed)

    if (pathArray.length > 0) { // If not at the root level, determine boundaries from parent
        let currentScanRowForParent = 1; // Start scanning from Row 1 for the parent
        let currentScanStartColForParent = 0;
        let currentScanEndColForParent = 25; // Max column for parent search

        for (let i = 0; i < pathArray.length; i++) {
            const folderNameInPath = pathArray[i];
            let foundParent = false;
            if (!fullSheetData[currentScanRowForParent - 1]) break; // Parent row doesn't exist (0-indexed)

            for (let col = currentScanStartColForParent; col <= currentScanEndColForParent; col++) {
                if (fullSheetData[currentScanRowForParent - 1][col] === folderNameInPath) {
                    branchStartCol = col; // This is the start column for the children
                    
                    // Find the endCol for this branch: next non-empty cell in the *same row*
                    // This defines the horizontal extent of the current folder's children
                    let nextSiblingCol = currentScanEndColForParent; // Default to current max
                    for (let siblingCol = col + 1; siblingCol <= currentScanEndColForParent; siblingCol++) {
                        if (fullSheetData[currentScanRowForParent - 1] && fullSheetData[currentScanRowForParent - 1][siblingCol]) {
                            nextSiblingCol = siblingCol - 1; // Column before the next sibling
                            break;
                        }
                    }
                    branchEndCol = nextSiblingCol;

                    // Update context for next iteration (if any) to find the next parent in path
                    currentScanRowForParent++; 
                    currentScanStartColForParent = branchStartCol;
                    currentScanEndColForParent = branchEndCol;
                    foundParent = true;
                    break;
                }
            }
            if (!foundParent) {
                console.error("Path segment not found in sheet:", folderNameInPath, "at level", i);
                // If a segment of the path isn't found, reset to root to prevent infinite loop or broken state
                loadFolders([]);
                return;
            }
        }
    }
    currentFolderContext.startCol = branchStartCol;
    currentFolderContext.endCol = branchEndCol;

    const subjectsDiv = document.getElementById('subjects');
    subjectsDiv.innerHTML = ""; // Clear previous content

    const itemsAtCurrentLevel = [];
    // Check if the row to scan for current items exists (0-indexed)
    if (fullSheetData[currentFolderContext.scanRow - 1]) { 
        for (let col = currentFolderContext.startCol; col <= currentFolderContext.endCol; col++) {
            const cellContent = fullSheetData[currentFolderContext.scanRow - 1][col];
            if (cellContent) { // If cell has content
                // Heuristic to determine if it's an exam:
                // An item is an exam if the cell directly below it (in the next row, same column)
                // contains content that starts with 'http' (indicating a question image URL).
                const contentBelow = fullSheetData[currentFolderContext.scanRow] ? fullSheetData[currentFolderContext.scanRow][col] : undefined;
                const isExam = (contentBelow && typeof contentBelow === 'string' && contentBelow.startsWith('http')); 

                if (isExam) {
                    itemsAtCurrentLevel.push({
                        type: 'exam',
                        name: cellContent,
                        // Store the 1-indexed cell location of the exam title (e.g., "A3")
                        cell: `${colIndexToLetter(col)}${currentFolderContext.scanRow}` 
                    });
                } else {
                    itemsAtCurrentLevel.push({
                        type: 'folder',
                        name: cellContent,
                        cell: `${colIndexToLetter(col)}${currentFolderContext.scanRow}` // Storing for consistency, though not strictly needed for folders
                    });
                }
            }
        }
    }

    // Render folders and exams
    itemsAtCurrentLevel.forEach(item => {
        const card = document.createElement("div");
        card.className = "folder-card"; // Reusing class name from your original main.js

        const icon = document.createElement("img");
        icon.className = "folder-icon";

        const title = document.createElement("div");
        title.className = "folder-title";
        title.textContent = item.name;

        if (item.type === 'folder') {
            icon.src = folderIconUrl;
            // Recursively call loadFolders with the new path
            card.onclick = () => loadFolders([...pathArray, item.name]);
        } else { // type === 'exam'
            icon.src = examIconUrl;
            title.style.fontWeight = "700";
            title.style.color = "#fff";
            card.onclick = () => {
                // Navigate to exam.html, passing the original folder path AND the exam's cell location
                window.location.href = `exam.html?folder=${encodeURIComponent(pathArray.join('/'))}&examCell=${encodeURIComponent(item.cell)}`;
            };
        }

        card.appendChild(icon);
        card.appendChild(title);
        subjectsDiv.appendChild(card);
    });

    // Show/hide back button
    document.getElementById('back-to-folders-btn').style.display = pathArray.length > 0 ? "" : "none";
}

// Back button logic
document.getElementById('back-to-folders-btn').onclick = function() {
    if (currentFolderContext.path.length === 0) return; // Already at root
    const newPath = [...currentFolderContext.path];
    newPath.pop(); // Go up one level
    loadFolders(newPath);
};

// Search logic (optional, simple folder/exam name filter) - kept as is
document.getElementById("exam-search").addEventListener("input", (e) => {
    const query = e.target.value.toLowerCase();
    Array.from(document.querySelectorAll('.folder-card')).forEach(card => {
        card.style.display = card.textContent.toLowerCase().includes(query) ? "" : "none";
    });
});

// On page load: Fetch all navigation data first, then load initial folders
document.addEventListener("DOMContentLoaded", async () => {
    await fetchNavigationData(); // Fetch the entire sheet for navigation
    loadFolders(); // Load the initial (root) folders
});
