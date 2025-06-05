
import { GoogleGenAI, GenerateContentResponse } from "@google/genai";
import { ExtractedAnswer } from '../types';

const API_KEY = process.env.API_KEY;

if (!API_KEY) {
  // This error will be caught by the App.tsx if it's thrown during module load,
  // but it's better to handle it where the API is used.
  // The UI will show a generic error if this service fails to initialize.
  console.error("API_KEY environment variable is not set.");
  // throw new Error("API_KEY environment variable is not set."); // Or handle gracefully
}

const ai = new GoogleGenAI({ apiKey: API_KEY! }); // Use non-null assertion as we check above or expect it to be set

const PROMPT = `Analyze the provided image, which shows a list of multiple-choice answers.
Each answer item typically consists of a question number followed by a letter in parentheses (e.g., '1. (a)', '11. (c)', '23. (b)'). Some variations might exist, try to be flexible.
Extract all such question numbers and their corresponding answer letters.
Return the results as a JSON array of objects. Each object must have two string properties:
- 'question': the question number as a string (e.g., "1", "11", "23").
- 'answer': the chosen letter as a lowercase string (e.g., "a", "c", "b"). Only include a, b, c, or d.

Example output format:
\`\`\`json
[
  {"question": "1", "answer": "a"},
  {"question": "2", "answer": "a"},
  {"question": "11", "answer": "c"},
  {"question": "65", "answer": "d"}
]
\`\`\`
If no valid answers are found or the image is unclear, return an empty array [].
Ensure you process all items listed in the image. The items might be arranged in columns and rows.
Focus on accuracy and adhere strictly to the JSON output format described.
Only output the JSON array. Do not include any other text or explanations outside the JSON structure.
`;

export async function extractAnswersFromImage(imageBase64Data: string): Promise<ExtractedAnswer[]> {
  if (!API_KEY) {
    throw new Error("Gemini API Key is not configured. Please set the API_KEY environment variable.");
  }

  const imagePart = {
    inlineData: {
      mimeType: 'image/jpeg', // Assuming JPEG, adjust if necessary or detect MIME type
      data: imageBase64Data,
    },
  };

  const textPart = {
    text: PROMPT,
  };

  try {
    const response: GenerateContentResponse = await ai.models.generateContent({
      model: 'gemini-2.5-flash-preview-04-17', // Using the recommended model
      contents: { parts: [imagePart, textPart] },
      config: {
        responseMimeType: "application/json",
        // temperature: 0.2 // Lower temperature for more deterministic output for OCR-like tasks
      }
    });

    let jsonStr = response.text.trim();
    
    // Remove markdown fences if present
    const fenceRegex = /^```(\w*)?\s*\n?(.*?)\n?\s*```$/s;
    const match = jsonStr.match(fenceRegex);
    if (match && match[2]) {
      jsonStr = match[2].trim();
    }

    // Sometimes the API might return a string like "```json\n[...]\n```" or just "[...]"
    // Additional check if it's still wrapped in backticks without language specifier
    if (jsonStr.startsWith("```") && jsonStr.endsWith("```")) {
        jsonStr = jsonStr.substring(3, jsonStr.length - 3).trim();
    }


    try {
      const parsedData = JSON.parse(jsonStr);
      if (Array.isArray(parsedData)) {
        // Further validation can be added here to check if objects match ExtractedAnswer structure
        return parsedData.filter(item => 
            typeof item.question === 'string' && 
            typeof item.answer === 'string' &&
            /^[a-d]$/i.test(item.answer.trim()) // Ensure answer is a, b, c, or d (case-insensitive)
        ).map(item => ({
            question: item.question.trim(),
            answer: item.answer.trim().toLowerCase()
        }));
      }
      console.warn("Gemini API response was not a JSON array:", parsedData);
      return []; // Return empty array if not an array
    } catch (e) {
      console.error("Failed to parse JSON response from Gemini API:", jsonStr, e);
      throw new Error(`Failed to parse AI response. Content: ${jsonStr.substring(0,100)}...`);
    }

  } catch (error) {
    console.error("Error calling Gemini API:", error);
    if (error instanceof Error) {
        // Check for common API key issues or quota issues
        if (error.message.includes("API key not valid")) {
            throw new Error("Invalid Gemini API Key. Please check your configuration.");
        }
        if (error.message.includes("quota")) {
            throw new Error("Gemini API quota exceeded. Please check your usage or limits.");
        }
    }
    throw new Error("Could not get a valid response from the AI model.");
  }
}
