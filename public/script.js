// Google Sheets API configuration for IMAGE URLs AND CORRECT ANSWERS (READ-ONLY)
const sheetId = '1qhAdWx619ipzojc_VSYkzRxPZcl24EYBZwcQgES5IYA'; // Your Google Sheet ID
const apiKey = 'AIzaSyBXGeD_pvVofRm_u74BG5Rt-CBHNB-Fh2I';   // Your Google Sheets API Key (for read-only access)

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
    // Initialize quiz by fetching data from Google Sheet
    await fetchQuizDataFromSheet();

    document.getElementById('next-btn').addEventListener('click', () => {
        saveCurrentAnswerToLocalArray(); // Save current question's answer to local array
        if (currentQuestion < totalQuestions - 1) {
            currentQuestion++;
            loadQuestion(currentQuestion);
        }
    });

    document.getElementById('prev-btn').addEventListener('click', () => {
        saveCurrentAnswerToLocalArray(); // Save current question's answer to local array
        if (currentQuestion > 0) {
            currentQuestion--;
            loadQuestion(currentQuestion);
        }
    });

    document.getElementById('submit-btn').addEventListener('click', () => {
        saveCurrentAnswerToLocalArray(); // Save current question's answer to local array
        checkResults();
        submitted = true; // Set submitted flag to true
        updateSidePanel(); // Update side panel colors after submission
        clearInterval(customTimer.interval);
    });

    document.getElementById('question-select').addEventListener('change', (event) => {
        saveCurrentAnswerToLocalArray(); // Save current question's answer to local array
        currentQuestion = parseInt(event.target.value);
        loadQuestion(currentQuestion);
    });

    // --- Google Apps Script Integration for Save/Load/Clear Answers ---
    document.getElementById('save-btn').addEventListener('click', async () => {
        saveCurrentAnswerToLocalArray(); // Ensure the currently displayed answer is saved to local array

        // Filter out null answers and format into "CellRef-Value" string
        const answeredQuestions = answers.filter(answer => answer !== null);

        if (answeredQuestions.length === 0) {
            console.log("No answers to save.");
            return;
        }

        let formattedAnswers = answers.map((answer, index) => {
            if (answer !== null) { // Only include answered questions
                const cellRef = getAnswerCellReference(index);
                return `${cellRef}-${answer}`;
            }
            return null; // Return null for unanswered questions, will be filtered out
        }).filter(item => item !== null).join(','); // Filter out nulls and join with comma

        // Construct the URL with a single "parameter"
        const params = new URLSearchParams({
            parameter: formattedAnswers
        }).toString();

        const fullUrl = `${appsScriptExecUrl}?${params}`;
        console.log("Opening URL to save answers:", fullUrl);
        window.open(fullUrl, '_blank');
        console.log("Save request sent by opening a new tab.");
    });

    document.getElementById('load-btn').addEventListener('click', async () => {
        const savedAnswersStartCell = getSavedAnswerCellReference(0); // Get the first cell for loading saved answers

        if (!savedAnswersStartCell || totalQuestions === 0) {
            console.error("Failed to load answers: Could not determine starting cell or no questions available.");
            console.log("Cannot load answers: Quiz data not initialized or invalid exam link.");
            return;
        }

        try {
            const response = await fetch(appsScriptExecUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: new URLSearchParams({
                    action: 'loadAnswersFormatted',
                    startCell: savedAnswersStartCell,
                    totalQuestions: totalQuestions
                }).toString()
            });

            const rawResponseText = await response.text();
            console.log("Raw response text from Apps Script (Load):", rawResponseText);

            const result = JSON.parse(rawResponseText);

            if (result.status === 'success' && typeof result.answersString === 'string') {
                const loadedAnswersArray = Array(totalQuestions).fill(null);

                if (result.answersString.trim() !== '') {
                    const parts = result.answersString.split(',');
                    parts.forEach(part => {
                        const [cellRef, rawValue] = part.split('-');
                        if (cellRef) {
                            // For each loaded cell reference, find the matching question index
                            for (let i = 0; i < totalQuestions; i++) {
                                const expectedCellRef = getSavedAnswerCellReference(i);
                                if (cellRef === expectedCellRef) {
                                    loadedAnswersArray[i] = rawValue === '' ? null : parseInt(rawValue);
                                    break;
                            }
                            }
                        }
                    });
                }

                answers = loadedAnswersArray;
                loadQuestion(currentQuestion);
                updateSidePanel();
                console.log('Answers loaded successfully via Google Apps Script.');
            } else {
                console.error('Error loading answers via Google Apps Script:', result.message || 'No answersString found or invalid format received.');
                answers = Array(totalQuestions).fill(null);
                loadQuestion(currentQuestion);
                updateSidePanel();
                console.log('Failed to load answers: ' + (result.message || 'No answers found or invalid format.'));
            }
        } catch (error) {
            console.error('Network or unexpected error while loading answers:', error);
            if (error instanceof SyntaxError && error.message.includes('JSON')) {
                console.error("Likely Apps Script returned non-JSON. Check Apps Script deployment and return format.");
            }
            answers = Array(totalQuestions).fill(null);
            loadQuestion(currentQuestion);
            updateSidePanel();
            console.log('An error occurred while trying to load answers. Please check your internet connection and Apps Script deployment.');
        }
    });

    document.getElementById('clear-btn').addEventListener('click', async () => {
        if (totalQuestions === 0) {
            console.log("No questions to clear answers for.");
            return;
        }

        // Format to send blanks: "L3-,L4-,L5-,..."
        let formattedBlanks = Array(totalQuestions).fill(null).map((_, index) => {
            const cellRef = getAnswerCellReference(index);
            return `${cellRef}-`; // Empty string after hyphen means blank
        }).join(',');

        try {
            const response = await fetch(appsScriptExecUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: new URLSearchParams({
                    action: 'clearAnswersFormatted', // New action name for Apps Script
                    cellsToClear: formattedBlanks // Send the formatted string with blanks
                }).toString()
            });

            // Log the raw response for debugging
            const rawResponseText = await response.text();
            console.log("Raw response text from Apps Script (Clear):", rawResponseText);

            const result = JSON.parse(rawResponseText); // Parse the raw text as JSON

            if (result.status === 'success') {
                answers = Array(totalQuestions).fill(null); // Clear local answers array
                submitted = false; // Reset submitted flag on clear
                loadQuestion(currentQuestion);
                updateSidePanel();
                console.log('Saved answers cleared successfully via Google Apps Script:', result.message);
            } else {
                console.error('Error clearing answers via Google Apps Script:', result.message);
                console.log('Failed to clear answers: ' + result.message);
            }
        } catch (error) {
            console.error('Network or unexpected error while clearing answers:', error);
            if (error instanceof SyntaxError && error.message.includes('JSON')) {
                console.error("Likely Apps Script returned non-JSON. Check Apps Script deployment and return format.");
            }
            console.log('An error occurred while trying to clear answers. Please check your internet connection and Apps Script deployment.');
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

    // Fetch 3 columns: image, correct answer, saved answer
    const startRowForQuestions = examTitleRow + 2;
    const startColLetter = colIndexToLetter(examTitleCol); // image
    const endColLetter = colIndexToLetter(examTitleCol + 2); // saved answer

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

        let loadedAnswers = [];

        if (!data.values || data.values.length === 0) {
            console.warn(`No question data found in range ${quizDataRange}.`);
        } else {
            data.values.forEach((row, i) => {
                const rawUrl = row[0]; // Image URL
                const rawCorrectAnswer = row[1]; // Correct Answer
                const rawSavedAnswer = row[2]; // Saved Answer

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

                    // Save loaded answer (null if empty)
                    loadedAnswers.push(rawSavedAnswer !== undefined && rawSavedAnswer !== '' ? parseInt(rawSavedAnswer) : null);
                }
            });

            totalQuestions = quizDataFromSheet.length;
            answers = loadedAnswers.slice(0, totalQuestions); // Use loaded answers
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
        answers[currentQuestion] = parseInt(selectedOption.value);
    }
    // Call updateSidePanel immediately after saving an answer
    updateSidePanel();
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
            if (hasAttempted && quizDataFromSheet[index] && answers[index] === quizDataFromSheet[index].correctAnswer) {
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
        if (answer !== null && quizDataFromSheet[index] && answer === quizDataFromSheet[index].correctAnswer) {
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
