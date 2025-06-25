// Firebase configuration
const firebaseConfig = {
    apiKey: "AIzaSyB1g8_jvDt5NSTHHf6Iz1mEaUAfWFHXhFc",
    authDomain: "exam-practice-133.firebaseapp.com",
    projectId: "exam-practice-133",
    storageBucket: "exam-practice-133.firebasestorage.app",
    messagingSenderId: "360770636796",
    appId: "1:360770636796:web:3c046ac1122c3d12df0079"
  };

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// Auth state observer
auth.onAuthStateChanged((user) => {
    if (user) {
        document.getElementById('auth-buttons').style.display = 'none';
        document.getElementById('user-info').style.display = 'flex';
        document.getElementById('user-email').textContent = user.email;
        // Show folder adder only for admin
        const folderAdderBtn = document.getElementById('folder-adder-btn');
        if (user.email === "shlok@admin.com") {
            folderAdderBtn.style.display = 'inline-block';
        } else {
            folderAdderBtn.style.display = 'none';
        }
    } else {
        document.getElementById('auth-buttons').style.display = 'block';
        document.getElementById('user-info').style.display = 'none';
        // Hide folder adder if not logged in
        const folderAdderBtn = document.getElementById('folder-adder-btn');
        if (folderAdderBtn) folderAdderBtn.style.display = 'none';
    }
});

// Auth modal functionality
let currentAuthMode = 'login'; // or 'register'

document.getElementById('login-btn').addEventListener('click', () => {
    currentAuthMode = 'login';
    document.getElementById('modal-title').textContent = 'Login';
    document.getElementById('auth-modal').style.display = 'block';
});

document.getElementById('register-btn').addEventListener('click', () => {
    currentAuthMode = 'register';
    document.getElementById('modal-title').textContent = 'Register';
    document.getElementById('auth-modal').style.display = 'block';
});

document.getElementById('modal-cancel-btn').addEventListener('click', () => {
    document.getElementById('auth-modal').style.display = 'none';
});

document.getElementById('modal-submit-btn').addEventListener('click', async () => {
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;

    try {
        if (currentAuthMode === 'login') {
            await auth.signInWithEmailAndPassword(email, password);
        } else {
            await auth.createUserWithEmailAndPassword(email, password);
        }
        document.getElementById('auth-modal').style.display = 'none';
    } catch (error) {
        alert('Error: ' + error.message);
    }
});

document.getElementById('logout-btn').addEventListener('click', () => {
    auth.signOut();
});

// Close modal when clicking outside
window.addEventListener('click', (event) => {
    const modal = document.getElementById('auth-modal');
    if (event.target === modal) {
        modal.style.display = 'none';
    }
});

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
    endCol: 16383 // Default to max column in Google Sheets (XFD, 0-indexed)
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
        // Changed from Z500 to XFD500 to cover all possible columns in Google Sheets (XFD is the last column).
        // Adjust 500 if your navigation structure goes deeper than 500 rows.
        const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/A1:XFD500?key=${apiKey}&valueRenderOption=UNFORMATTED_VALUE`);
        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }
        const data = await response.json();
        fullSheetData = data.values || [];
        console.log("Full Sheet Navigation Data Fetched:", fullSheetData);
    } catch (error) {
        console.error("Error fetching navigation data from Google Sheet:", error);
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
    let branchEndCol = 16383; // Default to max column 'XFD' (0-indexed)

    if (pathArray.length > 0) { // If not at the root level, determine boundaries from parent
        let currentScanRowForParent = 1; // Start scanning from Row 1 for the parent (1-indexed for logging)
        let currentScanStartColForParent = 0;
        let currentScanEndColForParent = 16383; // Max column for parent search

        for (let i = 0; i < pathArray.length; i++) {
            const folderNameInPath = pathArray[i];
            let foundParent = false;
            // Check if the parent row exists in fullSheetData (0-indexed array access)
            if (!fullSheetData[currentScanRowForParent - 1]) {
                console.error(`Parent row ${currentScanRowForParent} does not exist for path segment: ${folderNameInPath}`);
                break;
            }

            // Ensure we don't go out of bounds for the current row's actual data length
            const currentRowData = fullSheetData[currentScanRowForParent - 1] || [];
            const actualEndColForParent = Math.min(currentScanEndColForParent, currentRowData.length - 1);

            for (let col = currentScanStartColForParent; col <= actualEndColForParent; col++) {
                if (currentRowData[col] === folderNameInPath) {
                    branchStartCol = col; // This is the start column for the children
                    
                    // Find the endCol for this branch: next non-empty cell in the *same row*
                    // This defines the horizontal extent of the current folder's children
                    let nextSiblingCol = currentScanEndColForParent; // Default to current max
                    
                    // Iterate through the current row's data to find the next sibling's column
                    for (let siblingCol = col + 1; siblingCol < currentRowData.length; siblingCol++) {
                        if (currentRowData[siblingCol]) { // If a cell has content
                            nextSiblingCol = siblingCol - 1; // Column before the next sibling
                            break;
                        }
                    }
                    branchEndCol = nextSiblingCol;

                    // Update context for next iteration (if any) to find the next parent in path
                    currentScanRowForParent++; // Move to the next row (children's row)
                    currentScanStartColForParent = branchStartCol; // Children start from the parent's column
                    currentScanEndColForParent = branchEndCol; // Children's horizontal scan is limited by parent's branch end
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
    // Check if the row to scan for current items exists (0-indexed array access)
    if (fullSheetData[currentFolderContext.scanRow - 1]) { 
        const currentRowData = fullSheetData[currentFolderContext.scanRow - 1] || [];
        // Ensure we don't go out of bounds for the current row's actual data length
        const actualScanEndCol = Math.min(currentFolderContext.endCol, currentRowData.length - 1);

        for (let col = currentFolderContext.startCol; col <= actualScanEndCol; col++) {
            const cellContent = currentRowData[col];
            if (cellContent) { // If cell has content
                // Heuristic to determine if it's an exam:
                // An item is an exam if the cell directly below it (in the next row, same column)
                // contains content that starts with 'http' (indicating a question image URL).
                const nextRowData = fullSheetData[currentFolderContext.scanRow]; // Next row data
                const contentBelow = (nextRowData && nextRowData[col]) ? nextRowData[col] : undefined;
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
                        cell: `${colIndexToLetter(col)}${currentFolderContext.scanRow}` // Storing for consistency
                    });
                }
            }
        }
    }

    // Render folders and exams
    itemsAtCurrentLevel.forEach(item => {
        const card = document.createElement("div");
        card.className = "folder-card";

        const icon = document.createElement("img");
        icon.className = "folder-icon";

        const title = document.createElement("div");
        title.className = "folder-title";
        title.textContent = item.name;

        if (item.type === 'folder') {
            icon.src = folderIconUrl;
            card.onclick = () => loadFolders([...pathArray, item.name]);
        } else { // type === 'exam'
            icon.src = examIconUrl;
            title.style.fontWeight = "700";
            title.style.color = "#fff";
            card.onclick = () => {
                // Navigate to exam.html, passing the original folder path, the exam's cell location, and the exam title
                window.location.href = `exam.html?folder=${encodeURIComponent(pathArray.join('/'))}&examCell=${encodeURIComponent(item.cell)}&examTitle=${encodeURIComponent(item.name)}`;
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

// Search logic (optional, simple folder/exam name filter)
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
