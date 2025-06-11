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
        // User is signed in
        document.getElementById('user-info').style.display = 'flex';
        document.getElementById('user-email').textContent = user.email;
        // Load user's answers when they log in
        loadUserAnswers();
    } else {
        // User is signed out
        document.getElementById('user-info').style.display = 'none';
        // Redirect to login page
        window.location.href = 'index.html';
    }
});

// Logout button handler
document.getElementById('logout-btn').addEventListener('click', () => {
    auth.signOut();
});

// Google Sheets API configuration for IMAGE URLs AND CORRECT ANSWERS (READ-ONLY)
const sheetId = '1qhAdWx619ipzojc_VSYkzRxPZcl24EYBZwcQgES5IYA'; // Your Google Sheet ID
const apiKey = 'AIzaSyBXGeD_pvVofRm_u74BG5Rt-CBHNB-Fh2I';   // Your Google Sheets API Key (for read-only access)

// Google Apps Script endpoint for saving/loading/clearing answers
// This is the URL provided in the initial request for the parameter sender
const appsScriptExecUrl = "https://script.google.com/macros/s/AKfycbwZW1w0zUL7EPyoqjQqYnWr74pKsAJTz94274JiWAJAe5S7AS4hYTWhjYAz_xNKmFzO6A/exec";

// Global variables for quiz state
const urlParams = new URLSearchParams(window.location.search);
const folderName = urlParams.get('folder'); // e.g., "Module Physics/Electrostatics"
const examCell = urlParams.get('examCell'); // e.g., "A3" or "D5"

let test = folderName; // This will be used for Node.js backend save/load path
let questionsFolder = `data/${test}/`; // Path for ans.json (though ans.json is no longer used for correct answers/totalQuestions in exam.html)

let totalQuestions = 0; // Will be determined by the number of image/answer pairs from the sheet
let currentQuestion = 0;
let answers = []; // Stores the user's current session answers
let submitted = false; // Flag to track if the quiz has been submitted

// Array to store combined image URL and correct answer from the sheet
let quizDataFromSheet = [];

let customTimer = {
    totalSeconds: 600,
    remaining: 600,
    interval: null,
    running: false,
    laps: []
};

// Auto-save functionality
let autoSaveTimeout;
function scheduleAutoSave() {
    clearTimeout(autoSaveTimeout);
    autoSaveTimeout = setTimeout(() => {
        if (auth.currentUser) {
            saveAnswers();
        }
    }, 5000); // Auto-save after 5 seconds of inactivity
}

// Use only the exam name as the Firestore key
const examName = urlParams.get('examTitle');
const examKey = examName;

// Modified save function
async function saveAnswers() {
    const user = auth.currentUser;
    if (!user) {
        alert('Please login to save your answers');
        return;
    }

    try {
        await db.collection('users').doc(user.uid)
            .collection('exams').doc(examKey)
            .set({
                answers: answers,
                submitted: submitted,
                lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
            });
        console.log('Answers saved successfully');
    } catch (error) {
        console.error('Error saving answers:', error);
    }
}

// Modified load function
async function loadUserAnswers() {
    const user = auth.currentUser;
    if (!user) return;

    try {
        const doc = await db.collection('users').doc(user.uid)
            .collection('exams').doc(examKey)
            .get();
        
        if (doc.exists) {
            const data = doc.data();
            answers = data.answers || Array(totalQuestions).fill(null);
            submitted = false; // Always reset to attempt mode on load
            loadQuestion(currentQuestion);
            updateSidePanel();
        } else {
            submitted = false; // If no data, ensure not in submitted mode
        }
    } catch (error) {
        console.error('Error loading answers:', error);
        submitted = false; // On error, ensure not in submitted mode
    }
}

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

// Helper to convert 1-indexed column letter to 0-indexed index (A -> 0, B -> 1, ...)
function colLetterToIndex(colLetter) {
    let index = 0;
    for (let i = 0; i < colLetter.length; i++) {
        index = index * 26 + (colLetter.charCodeAt(i) - 65 + 1);
    }
    return index - 1; // Convert to 0-indexed
}

// Helper to parse cell reference (e.g., "A3" -> {col: 0, row: 2})
function parseCellReference(cellRef) {
    const match = cellRef.match(/^([A-Z]+)(\d+)$/);
    if (!match) {
        console.error("Invalid cell reference format:", cellRef);
        return null;
    }
    const colLetter = match[1];
    const rowNum = parseInt(match[2], 10);
    return {
        col: colLetterToIndex(colLetter), // 0-indexed column
        row: rowNum - 1 // 0-indexed row
    };
}

// Helper function to calculate the specific cell reference for an answer on the Google Sheet.
// Answers are stored 2 columns to the right of the examCell's column, and one row below the examCell's row,
// then incrementing by question index.
// For example, if examCell is J3, question 0 answer is in L4, question 1 in L5, etc.
function getAnswerCellReference(questionIndex) {
    const parsedCell = parseCellReference(examCell); // examCell is a global variable from URL params
    if (!parsedCell) {
        console.error("Cannot determine answer cell: Invalid examCell parameter.");
        return null;
    }
    // Answers column is 2 columns to the right of examCell's column
    const answersColIndex = parsedCell.col + 2;
    // Answer for questionIndex is in the row of examCell + 1 (for one row down) + questionIndex
    const answerRowIndex = parsedCell.row + 1 + questionIndex; // Adjusted row calculation here

    // Convert 0-indexed column and row back to A1 notation (e.g., L4)
    const answersColLetter = colIndexToLetter(answersColIndex);
    const answersRowNum = answerRowIndex + 1; // Convert back to 1-indexed row number for A1 notation
    return `${answersColLetter}${answersRowNum}`;
}

// Helper function to get the cell reference for saved answers (one column to the right of answer cell)
function getSavedAnswerCellReference(questionIndex) {
    const parsedCell = parseCellReference(examCell);
    if (!parsedCell) {
        console.error("Cannot determine saved answer cell: Invalid examCell parameter.");
        return null;
    }
    // Saved answers column is 3 columns to the right of examCell's column (one more than answer column)
    const savedAnswersColIndex = parsedCell.col + 3;
    // Saved answer for questionIndex is in the same row as the answer
    const savedAnswerRowIndex = parsedCell.row + 1 + questionIndex;

    // Convert 0-indexed column and row back to A1 notation
    const savedAnswersColLetter = colIndexToLetter(savedAnswersColIndex);
    const savedAnswersRowNum = savedAnswerRowIndex + 1;
    return `${savedAnswersColLetter}${savedAnswersRowNum}`;
}

document.addEventListener('DOMContentLoaded', async () => {
    submitted = false; // Always reset to attempt mode on page load
    // Set the main title to the actual exam name
    if (examName) {
        document.getElementById('exam-title').textContent = examName;
    }
    // Home button handler
    document.getElementById('home-btn').addEventListener('click', () => {
        window.location.href = 'index.html';
    });
    // Initialize quiz by fetching data from Google Sheet
    await fetchQuizDataFromSheet();

    document.getElementById('next-btn').addEventListener('click', () => {
        saveCurrentAnswerToLocalArray();
        if (currentQuestion < totalQuestions - 1) {
            currentQuestion++;
            loadQuestion(currentQuestion);
        }
    });

    document.getElementById('prev-btn').addEventListener('click', () => {
        saveCurrentAnswerToLocalArray();
        if (currentQuestion > 0) {
            currentQuestion--;
            loadQuestion(currentQuestion);
        }
    });

    document.getElementById('submit-btn').addEventListener('click', () => {
        saveCurrentAnswerToLocalArray();
        checkResults();
        submitted = true;
        updateSidePanel();
        clearInterval(customTimer.interval);
        saveAnswers(); // Save after submission
    });

    document.getElementById('question-select').addEventListener('change', (event) => {
        saveCurrentAnswerToLocalArray();
        currentQuestion = parseInt(event.target.value);
        loadQuestion(currentQuestion);
    });

    // Modified save button click handler
    document.getElementById('save-btn').addEventListener('click', async () => {
        saveCurrentAnswerToLocalArray();
        await saveAnswers();
    });

    document.getElementById('load-btn').addEventListener('click', async () => {
        const user = auth.currentUser;
        if (!user) {
            alert('Please login to load your answers');
            return;
        }
        await loadUserAnswers();
    });

    document.getElementById('clear-btn').addEventListener('click', async () => {
        const user = auth.currentUser;
        if (!user) {
            alert('Please login to clear your answers');
            return;
        }

        try {
            await db.collection('users').doc(user.uid)
                .collection('exams').doc(examKey)
                .delete();
            
            answers = Array(totalQuestions).fill(null);
            submitted = false;
            loadQuestion(currentQuestion);
            updateSidePanel();
            console.log('Answers cleared successfully from Firestore');
        } catch (error) {
            console.error('Error clearing answers from Firestore:', error);
            alert('Failed to clear answers. Please try again.');
        }
    });

    // Timer event listeners
    document.getElementById('timer-set').addEventListener('click', setCustomTimer);
    document.getElementById('timer-start').addEventListener('click', startCustomTimer);
    document.getElementById('timer-pause').addEventListener('click', pauseCustomTimer);
    document.getElementById('timer-stop').addEventListener('click', stopCustomTimer);
    document.getElementById('timer-lap').addEventListener('click', lapCustomTimer);
});

// Make the timer window draggable
(function() {
    const timerWindow = document.getElementById('custom-timer-window');
    const header = document.getElementById('custom-timer-header');
    let offsetX = 0, offsetY = 0, isDown = false;

    if (!timerWindow || !header) return;

    header.addEventListener('mousedown', function(e) {
        isDown = true;
        offsetX = e.clientX - timerWindow.offsetLeft;
        offsetY = e.clientY - timerWindow.offsetTop;
        document.body.style.userSelect = 'none';
    });

    document.addEventListener('mousemove', function(e) {
        if (!isDown) return;
        timerWindow.style.left = (e.clientX - offsetX) + 'px';
        timerWindow.style.top = (e.clientY - offsetY) + 'px';
    });

    document.addEventListener('mouseup', function() {
        isDown = false;
        document.body.style.userSelect = '';
    });
})();

// --- Quiz Data Fetching from Google Sheet based on examCell ---
async function fetchQuizDataFromSheet() {
    const sheetTitleElement = document.getElementById('sheetTitle');
    const parsedCell = parseCellReference(examCell);

    if (!parsedCell) {
        console.error("Invalid examCell parameter:", examCell);
        if (sheetTitleElement) sheetTitleElement.textContent = "Error: Invalid Exam Link.";
        return;
    }

    const examTitleCol = parsedCell.col;
    const examTitleRow = parsedCell.row; // 0-indexed

    // Fetch 2 columns: image and correct answer (removed saved answer column)
    const startRowForQuestions = examTitleRow + 2;
    const startColLetter = colIndexToLetter(examTitleCol); // image
    const endColLetter = colIndexToLetter(examTitleCol + 1); // correct answer

    const quizDataRange = `${startColLetter}${startRowForQuestions}:${endColLetter}${startRowForQuestions + 999}`;

    try {
        const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${quizDataRange}?key=${apiKey}&valueRenderOption=UNFORMATTED_VALUE`;
        const response = await fetch(url);
        if (!response.ok) {
            console.error(`HTTP error! Status: ${response.status}`);
            throw new Error(`Failed to fetch quiz data from Google Sheets for range: ${quizDataRange}`);
        }
        const data = await response.json();
        console.log("Google Sheets API Raw Response for Quiz Data:", data);

        quizDataFromSheet = [];

        if (sheetTitleElement) {
            const examTitle = urlParams.get('examTitle') || "Quiz";
            sheetTitleElement.textContent = examTitle;
        }

        if (!data.values || data.values.length === 0) {
            console.warn(`No question data found in range ${quizDataRange}.`);
        } else {
            data.values.forEach((row, i) => {
                const rawUrl = row[0]; // Image URL
                const rawCorrectAnswer = row[1]; // Correct Answer

                if (rawUrl && typeof rawUrl === 'string') {
                    let processedUrl = rawUrl;
                    const fileIdMatch = processedUrl.match(/drive\.google\.com\/file\/d\/([^/]+)/);
                    if (fileIdMatch) {
                        processedUrl = `https://drive.google.com/uc?id=${fileIdMatch[1]}`;
                    }
                    processedUrl = processedUrl.replace('/uc?', '/thumbnail?');
                    if (!processedUrl.includes('&sz=')) {
                        processedUrl += "&sz=w1000";
                    } else {
                        processedUrl = processedUrl.replace(/&sz=w\d+/, '&sz=w1000');
                    }

                    const correctAnswer = rawCorrectAnswer ? parseInt(rawCorrectAnswer) : null;
                    quizDataFromSheet.push({
                        imageUrl: processedUrl,
                        correctAnswer: correctAnswer
                    });
                }
            });

            totalQuestions = quizDataFromSheet.length;
            answers = Array(totalQuestions).fill(null); // Initialize with null answers
            populateQuestionSelect();
            populateSidePanel();

            if (quizDataFromSheet.length === 0) {
                console.warn(`No valid image/answer pairs found in range ${quizDataRange} after processing.`);
            }
        }
    } catch (err) {
        console.error("Error fetching quiz data from sheet:", err);
        if (sheetTitleElement) sheetTitleElement.textContent = "Error: Invalid Exam Link.";
        quizDataFromSheet = [];
        totalQuestions = 0;
        answers = [];
    } finally {
        currentQuestion = 0;
        loadQuestion(currentQuestion);
        updateSidePanel();
    }
}

// --- Quiz UI Update Functions ---
function saveCurrentAnswerToLocalArray() {
    const selectedOption = document.querySelector('input[name="option"]:checked');
    if (selectedOption) {
        answers[currentQuestion] = selectedOption.value;
        submitted = false; // Reset submitted flag when changing answers
        scheduleAutoSave();
    } else {
        answers[currentQuestion] = null;
        submitted = false; // Reset submitted flag when changing answers
    }
}

function populateQuestionSelect() {
    const questionSelect = document.getElementById('question-select');
    questionSelect.innerHTML = '';
    for (let i = 0; i < totalQuestions; i++) {
        const option = document.createElement('option');
        option.value = i;
        option.textContent = `Question ${i + 1}`;
        questionSelect.appendChild(option);
    }
}

function populateSidePanel() {
    const sidePanel = document.getElementById('side-panel');
    sidePanel.innerHTML = '';
    for (let i = 0; i < totalQuestions; i++) {
        const button = document.createElement('button');
        button.textContent = i + 1;
        button.classList.add('question-button');
        button.addEventListener('click', () => {
            saveCurrentAnswerToLocalArray();
            currentQuestion = i;
            loadQuestion(currentQuestion);
        });
        sidePanel.appendChild(button);
    }
    updateSidePanel(); // Initial update after populating buttons
}

function loadQuestion(index) {
    const questionImage = document.getElementById('question-image');

    // Use the URL from quizDataFromSheet array
    if (quizDataFromSheet.length > 0 && quizDataFromSheet[index] && quizDataFromSheet[index].imageUrl) {
        const imageUrlToDisplay = quizDataFromSheet[index].imageUrl;
        console.log("Attempting to display question image URL from sheet:", imageUrlToDisplay); // Log URL for inspection
        questionImage.src = imageUrlToDisplay;
        questionImage.alt = `Question ${index + 1} image`;
        questionImage.style.display = 'block'; // Ensure image is visible
    } else {
        // Fallback if no image URL from sheet or index out of bounds
        questionImage.src = 'https://placehold.co/600x400/333/eee?text=Image+Not+Found';
        questionImage.alt = 'Image not found or no URL available from sheet';
        questionImage.style.display = 'block';
        console.warn(`No image URL found in Google Sheet for question ${index + 1}.`);
    }

    const options = document.getElementsByName('option');
    options.forEach(option => option.checked = false);

    if (answers[index] !== null) {
        options.forEach(option => {
            if (option.value === answers[index].toString()) {
                option.checked = true;
            }
        });
    }

    document.getElementById('question-status').textContent = `Question ${index + 1}/${totalQuestions}`;
    document.getElementById('answered-status').textContent = `Answered: ${answers.filter(a => a !== null).length}`;
    document.getElementById('question-select').value = index;

    updateSidePanel(); // Update side panel to highlight current question and colors
}

function updateSidePanel() {
    const buttons = document.querySelectorAll('.question-button');
    buttons.forEach((button, index) => {
        // Check if an answer has been attempted for this question
        const hasAttempted = answers[index] !== null;

        if (submitted) {
            // After submission: green if correct, red if wrong
            // We need quizDataFromSheet[index] to exist and have a correctAnswer to check correctness
            if (hasAttempted && quizDataFromSheet[index] && Number(answers[index]) === quizDataFromSheet[index].correctAnswer) {
                button.style.backgroundColor = 'green'; // Correct answer
                button.style.color = 'white'; // White text for visibility
            } else if (hasAttempted) {
                button.style.backgroundColor = 'red'; // Incorrect answer (or attempted without a valid correct answer to compare)
                button.style.color = 'white'; // White text for visibility
            } else {
                button.style.backgroundColor = 'white'; // Not attempted
                button.style.color = 'black'; // Black text for visibility
            }
        } else {
            // Before submission: green if attempted, white if not
            if (hasAttempted) {
                button.style.backgroundColor = '#90EE90'; // Using lightgreen for attempted before submission
                button.style.color = 'black';
            } else {
                button.style.backgroundColor = 'white'; // Not attempted
                button.style.color = 'black';
            }
        }

        // Highlight the current question button
        if (index === currentQuestion) {
            button.style.border = '2px solid blue'; // Highlight active question
            button.style.fontWeight = 'bold';
        } else {
            button.style.border = '1px solid #ccc'; // Reset border for others
            button.style.fontWeight = 'normal';
        }
    });
}

function checkResults() {
    let score = 0;
    answers.forEach((answer, index) => {
        // Ensure quizDataFromSheet has data for this index before checking answer
        if (answer !== null && quizDataFromSheet[index] && Number(answer) === quizDataFromSheet[index].correctAnswer) {
            score++;
        }
    });
    document.getElementById('result').textContent = `You scored ${score} out of ${totalQuestions}`;
    updateSidePanel();
}


function updateTimerDisplay() {
    const min = Math.floor(customTimer.remaining / 60);
    const sec = customTimer.remaining % 60;
    document.getElementById('timer-display').textContent = `${min}:${sec < 10 ? '0' : ''}${sec}`;
}

function setCustomTimer() {
    const min = parseInt(document.getElementById('timer-minutes').value) || 0;
    const sec = parseInt(document.getElementById('timer-seconds').value) || 0;
    customTimer.totalSeconds = min * 60 + sec;
    customTimer.remaining = customTimer.totalSeconds;
    customTimer.laps = [];
    document.getElementById('timer-laps').innerHTML = '';
    updateTimerDisplay();
}

function startCustomTimer() {
    if (customTimer.running) return;
    customTimer.running = true;
    customTimer.interval = setInterval(() => {
        if (customTimer.remaining > 0) {
            customTimer.remaining--;
            updateTimerDisplay();
        } else {
            stopCustomTimer();
            // Removed alert, logging to console instead
            console.log("Time's up!");
            // Automatically submit the quiz if time runs out
            if (!submitted) {
                document.getElementById('submit-btn').click();
            }
        }
    }, 1000);
}

function pauseCustomTimer() {
    if (customTimer.running) {
        clearInterval(customTimer.interval);
        customTimer.running = false;
    }
}

function stopCustomTimer() {
    clearInterval(customTimer.interval);
    customTimer.running = false;
    customTimer.remaining = customTimer.totalSeconds;
    updateTimerDisplay();
}

function lapCustomTimer() {
    const min = Math.floor(customTimer.remaining / 60);
    const sec = customTimer.remaining % 60;
    const lapTime = `${min}:${sec < 10 ? '0' : ''}${sec}`;
    customTimer.laps.push(lapTime);
    const lapList = document.getElementById('timer-laps');
    const li = document.createElement('li');
    li.textContent = `Lap ${customTimer.laps.length}: ${lapTime}`;
    lapList.appendChild(li);
}

// Initialize display
updateTimerDisplay();
