import express from 'express';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

const app = express();

// Load environment variables
dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;

// Middleware to parse JSON request bodies
app.use(express.json());
app.use(express.static(path.join(__dirname, 'images'))); // Serve images folder statically

// Serve the index.html file on the root URL
app.get('/', (req, res) => {
    res.sendFile(path.resolve(__dirname, 'index.html')); // Use __dirname for absolute path
});

// API URLs and Keys
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const HUGGINGFACE_API_URL = "https://api-inference.huggingface.co/models/black-forest-labs/FLUX.1-dev";
const HUGGINGFACE_API_KEY = process.env.HUGGINGFACE_API_KEY;

// Define a route to generate the comic
app.post('/generate-comic', async (req, res) => {
    const scenario = req.body.scenario;
    const panels = await generatePanels(scenario);

    // Generate image paths and create images for each panel
    const imagePaths = [];
    for (let i = 0; i < panels.length-5; i++) { // Ensure it generates for all panels
        const prompt = createImagePrompt(panels[i]);
        const imageFilename = `panel_${i + 1}.png`;
        
        // Save the images to the public folder
        await generateComicImage(prompt, 'public', imageFilename);
        imagePaths.push(`/public/${imageFilename}`);
    }

    res.status(200).send('Comic panels generated successfully!');
});
app.post('/generate-mnemonic', async (req, res) => {
    const chemicalReaction = req.body.reaction; // Get the chemical reaction from the request

    try {
        // Create prompt for the Gemini API
        const mnemonicPrompt = createMnemonicPrompt(chemicalReaction);

        // Send request to Gemini API
        const mnemonicResponse = await axios.post(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
            contents: [{ parts: [{ text: mnemonicPrompt }] }]
        }, {
            headers: { 'Content-Type': 'application/json' }
        });

        const mnemonicData = mnemonicResponse.data;
        if (mnemonicData?.candidates?.length > 0) {
            const mnemonic = mnemonicData.candidates[0].content.parts[0].text;
            res.status(200).json({ mnemonic }); // Send back the mnemonic
        } else {
            throw new Error('No mnemonic generated.');
        }
    } catch (error) {
        console.error('Error generating mnemonic:', error.message);
        res.status(500).send('Error generating mnemonic: ' + error.message);
    }
});

// Function to create the prompt for mnemonic generation
function createMnemonicPrompt(reaction) {
    return `Create a mnemonic to help remember the chemical reaction: ${reaction}. Provide a short and catchy phrase.`;
}
// Function to generate panels using AI
async function generatePanels(scenario) {
    const requestBody = {
        contents: [{ parts: [{ text: createPrompt(scenario) }] }]
    };

    console.log("Generated Prompt for Gemini API:", createPrompt(scenario));

    try {
        const response = await axios.post(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, requestBody, {
            headers: { 'Content-Type': 'application/json' }
        });

        const data = response.data;

        if (data?.candidates?.length > 0) {
            const panels = extractPanelInfo(data.candidates[0].content.parts[0].text);
            console.log("Extracted Panels:", panels); // Log extracted panels
            return panels;
        } else {
            throw new Error('No candidates found in Gemini API response.');
        }
    } catch (error) {
        console.error('Error generating panels:', error.message);
        throw error;
    }
}

// Create the prompt for the AI model
function createPrompt(scenario) {
    return `You are a cartoon creator.
You will be given a short scenario, you must split it into 6 parts.
Each part will be a different cartoon panel.
For each cartoon panel, you will write a description of it with:
- the characters in the panel, they must be described precisely each time
- the background of the panel
The description should be only words or groups of words delimited by commas, no sentences.
Always use the characters' descriptions instead of their names in the cartoon panel description.
You cannot use the same description twice.
You will also write the text of the panel.
The text should not be more than 2 small sentences.
Each sentence should start with the character name.
The story should have quotes and also more specific instruction for image generation. 
The generated story should be good enough for the comic image generation. So give accordingly specifying its requirements also in each panel. 
Short Scenario:
${scenario}

Split the scenario into 6 parts:
`;
}

function extractPanelInfo(inputText) {
    const panels = [];
    const panelRegex = /## Panel \d+\s*\n\n\*\*Characters:\*\*\s*([\s\S]*?)\n\*\*Background:\*\*\s*([\s\S]*?)\n\*\*Text:\*\*\s*([\s\S]*?)(?=\n\n## Panel \d+|\n*$)/g;
    let match;

    while ((match = panelRegex.exec(inputText)) !== null) {
        const characters = match[1].trim();
        const background = match[2].trim();
        const text = match[3].trim();

        panels.push({ characters, background, text });
    }

    return panels;
}

// Function to generate an image from a prompt and save it
async function generateComicImage(prompt, folder = 'public', filename = 'comic_image.png') {
    try {
        // Query the model with the prompt (input only, no extra parameters)
        const imageBlob = await query({
            inputs: prompt,
        });

        console.log('Image generated successfully, saving...');
        // Save the image as a PNG
        await saveImage(imageBlob, folder, filename);
    } catch (error) {
        // Log the error details
        console.error('Error generating image:', error.message);
    }
}

// Function to save the image from Blob to Buffer and write it to a file
async function saveImage(blob, folder, filename) {
    const filePath = path.join(folder, filename);

    try {
        // Convert Blob to ArrayBuffer and then to Buffer
        const arrayBuffer = await blob.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        // Write the buffer to a file
        fs.writeFileSync(filePath, buffer);
        console.log(`Image saved successfully at: ${filePath}`);
    } catch (error) {
        console.error('Error saving the image:', error);
    }
}

// Function to query the Hugging Face model via the API and generate an image
async function query(data) {
    const response = await fetch(
        HUGGINGFACE_API_URL,
        {
            headers: {
                Authorization: `Bearer ${HUGGINGFACE_API_KEY}`, // Use API key from .env
                "Content-Type": "application/json",
            },
            method: "POST",
            body: JSON.stringify(data),
        }
    );

    const result = await response.blob();
    return result;
}

// Create prompts for image generation based on panel content
function createImagePrompt(panel) {
    return `*Characters:* ${panel.characters}
*Background:* ${panel.background}
*Text:* ${panel.text}
*Image Generation Requirements:* Ensure the scene captures the emotions and actions described.`;
}

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
