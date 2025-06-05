// Google Sheets API configuration for IMAGE URLs AND CORRECT ANSWERS (READ-ONLY)
const sheetId = '1qhAdWx619ipzojc_VSYkzRxPZcl24EYBZwcQgES5IYA'; // Your Google Sheet ID
const apiKey = 'AIzaSyBXGeD_pvVofRm_u74BG5Rt-CBHNB-Fh2I';   // Your Google Sheets API Key (for read-only access)

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

    // --- Node.js Backend Integration for Save/Load/Clear Answers (reverted) ---
    document.getElementById('save-btn').addEventListener('click', () => {
        fetch('/save-answers', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ testPath: test, answers })
        })
        .then(res => res.json())
        .then(data => {
            console.log('Answers saved via backend:', data);
        })
        .catch(error => {
            console.error('Error saving answers via backend:', error);
        });
    });

    document.getElementById('load-btn').addEventListener('click', () => {
        fetch(`/load-answers?testPath=${encodeURIComponent(test)}`)
            .then(res => res.json())
            .then(saved => {
                if (Array.isArray(saved) && saved.length === totalQuestions) {
                    answers = saved;
                    loadQuestion(currentQuestion);
                    updateSidePanel();
                    console.log('Answers loaded via backend:', saved);
                } else {
                    console.warn('No saved answers found or format incorrect via backend.');
                }
            })
            .catch(error => {
                console.error('Error loading answers via backend:', error);
            });
    });

    document.getElementById('clear-btn').addEventListener('click', () => {
        fetch('/clear-answers', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ testPath: test, totalQuestions })
        })
        .then(res => res.json())
        .then(data => {
            answers = Array(totalQuestions).fill(null);
            submitted = false; // Reset submitted flag on clear
            loadQuestion(currentQuestion);
            updateSidePanel();
            console.log('Saved answers cleared via backend:', data);
        })
        .catch(error => {
            console.error('Error clearing answers via backend:', error);
        });
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

    // Determine the range for questions and answers
    // Questions start from the row *below* the exam title, in the same column.
    // Answers are in the column to the right of the questions.
    const startRowForQuestions = examTitleRow + 2; // +1 for 1-indexed, +1 for row below title (0-indexed array = 1-indexed row)
    const startColLetter = colIndexToLetter(examTitleCol); // Column of image URL
    const endColLetter = colIndexToLetter(examTitleCol + 1); // Column of correct answer

    // Define a large enough range to fetch all questions for this exam
    // Increased from +99 to +999 to fetch up to 1000 questions for the exam
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

        quizDataFromSheet = []; // Clear previous data

        // Set the quiz title from the examCell itself
        if (sheetTitleElement) {
            const examTitle = urlParams.get('examTitle') || "Quiz"; // Get from URL param, fallback to "Quiz"
            sheetTitleElement.textContent = examTitle;
        }

        if (!data.values || data.values.length === 0) {
            console.warn(`No question data found in range ${quizDataRange}.`);
        } else {
            data.values.forEach((row) => {
                const rawUrl = row[0]; // Image URL (from column A of the fetched range, which is the exam's image column)
                const rawCorrectAnswer = row[1]; // Correct Answer (from column B of the fetched range, which is the exam's answer column)

                if (rawUrl && typeof rawUrl === 'string') {
                    let processedUrl = rawUrl;
                    // Convert Google Drive share link to direct link (uc)
                    const fileIdMatch = processedUrl.match(/drive\.google\.com\/file\/d\/([^/]+)/);
                    if (fileIdMatch) {
                        processedUrl = `https://drive.google.com/uc?id=${fileIdMatch[1]}`;
                    }

                    // Replace 'uc' with 'thumbnail' if present
                    processedUrl = processedUrl.replace('/uc?', '/thumbnail?');

                    // Append size parameter if not already present
                    if (!processedUrl.includes('&sz=')) {
                        processedUrl += "&sz=w1000";
                    } else {
                        // If &sz= is present, update it to w1000
                        processedUrl = processedUrl.replace(/&sz=w\d+/, '&sz=w1000');
                    }

                    // Parse correct answer as integer, default to null if invalid
                    const correctAnswer = rawCorrectAnswer ? parseInt(rawCorrectAnswer) : null;

                    quizDataFromSheet.push({
                        imageUrl: processedUrl,
                        correctAnswer: correctAnswer
                    });
                } else {
                    console.warn(`Skipping invalid or empty URL row in quiz data:`, row);
                }
            });

            totalQuestions = quizDataFromSheet.length; // Set totalQuestions based on fetched data
            answers = Array(totalQuestions).fill(null); // Initialize user answers array
            populateQuestionSelect();
            populateSidePanel();

            if (quizDataFromSheet.length === 0) {
                console.warn(`No valid image/answer pairs found in range ${quizDataRange} after processing.`);
            }
        }
    } catch (err) {
        console.error("Error fetching quiz data from sheet:", err);
        if (sheetTitleElement) sheetTitleElement.textContent = "Failed to load quiz questions.";
        quizDataFromSheet = [];
        totalQuestions = 0; // Reset total questions on error
        answers = []; // Reset answers
    } finally {
        currentQuestion = 0; // Reset index
        loadQuestion(currentQuestion); // Load the first question (or placeholder)
        updateSidePanel(); // Update side panel with loaded/reset answers
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
                button.style.backgroundColor = 'green'; // Using lightgreen for attempted before submission
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
            // Optional: alert or visual cue when timer runs out
            alert("Time's up!");
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