import type { Request, Response } from 'express';
import express from 'express';
import { GoogleGenerativeAI } from '@google/generative-ai';
import type { Part } from '@google/generative-ai';
import multer from 'multer';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from .env file
dotenv.config();

const app = express();
const port = 3000;

// Configure Google Generative AI with your API key
const geminiApiKey = process.env.GEMINI_API_KEY;
if (!geminiApiKey) {
    console.error('Error: GEMINI_API_KEY is not defined in the .env file.');
    process.exit(1); // Exit the application if the key is missing
}
const genAI = new GoogleGenerativeAI(geminiApiKey);

// Configure multer for file uploads
const storage = multer.memoryStorage(); // Store the file in memory as a buffer
const upload = multer({ storage: storage });

// Helper function to convert a file buffer into the required format for the API
function fileToGenerativePart(buffer: Buffer, mimeType: string): Part {
    return {
        inlineData: {
            data: buffer.toString('base64'),
            mimeType
        }
    };
}

// Set up a simple endpoint for a health check
app.get('/', (req: Request, res: Response) => {
    res.status(200).send('Gemini Vision Pro Express server is running!');
});

function cleanGeminiResponse(rawText: string): string {
    // Menghapus blok kode Markdown jika ada
    const jsonMatch = rawText.match(/```json\n([\s\S]*?)\n```/);
    if (jsonMatch && jsonMatch[1]) {
        return jsonMatch[1].trim();
    }
    // Jika tidak ada blok kode, kembalikan teks asli
    return rawText.trim();
}

// Main API endpoint to analyze the food image
app.post('/analyze-food', upload.single('foodImage'), async (req: Request, res: Response) => {
  try {
        if (!req.file) {
            return res.status(400).json({ error: 'No image file uploaded.' });
        }

        const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

        const prompt = "Analisis gambar makanan ini. Berikan nama makanan, perkiraan jumlah kalori dalam format angka, dan daftar bahan-bahan utamanya. Jawab dalam format JSON saja tanpa teks tambahan.";

        const imagePart = fileToGenerativePart(req.file.buffer, req.file.mimetype);

        const result = await model.generateContent([prompt, imagePart]);
        const response = await result.response;
        const textResponse = response.text();

        // Gunakan fungsi helper untuk membersihkan teks sebelum parsing
        const cleanedResponse = cleanGeminiResponse(textResponse);

        try {
            const parsedData = JSON.parse(cleanedResponse);
            res.json({ success: true, data: parsedData });
        } catch (parseError: unknown) {
            let errorMessage = 'An unknown error occurred.';
            if (parseError instanceof Error) {
                errorMessage = parseError.message;
            }
            console.error('Failed to parse Gemini response as JSON:', textResponse);
            res.status(500).json({ success: false, error: 'Failed to parse Gemini response.', details: errorMessage, rawResponse: textResponse });
        }
    } catch (error: unknown) {
        let errorMessage = 'An unknown error occurred.';
        if (error instanceof Error) {
            errorMessage = error.message;
        }
        console.error('Error analyzing image:', error);
        res.status(500).json({ success: false, error: 'Failed to analyze image.', details: errorMessage });
    }
});

// Start the server
app.listen(port, () => {
    console.log(`Server is listening at http://localhost:${port}`);
});