import express from 'express';
import { GoogleGenAI, Type } from '@google/genai';
import type { Part } from '@google/genai';
import type { Request, Response } from 'express';
import multer from 'multer';
import dotenv from 'dotenv';
import path from 'path';
import pkg from "pg";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

dotenv.config();

const app = express();
const port = 3000;
const { Pool } = pkg;

// Configure database
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
   ssl: {
    rejectUnauthorized: false, 
  },
});

app.use(express.json());

// Configure Google Generative AI with your API key
const geminiApiKey = process.env.GEMINI_API_KEY;
if (!geminiApiKey) {
    console.error('Error: GEMINI_API_KEY is not defined in the .env file.');
    process.exit(1);
}
// 2. KLIEN BARU: GoogleGenAI
const genAI = new GoogleGenAI({ apiKey: geminiApiKey }); // Inisialisasi menggunakan objek konfigurasi

// Configure multer for file uploads
const storage = multer.memoryStorage();
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

// Skema JSON untuk Output Terstruktur
const foodAnalysisSchema = {
    type: Type.OBJECT,
    properties: {
        nama_makanan: {
            type: Type.STRING,
            description: "Nama umum makanan yang teridentifikasi."
        },
        jumlah_kalori: {
            type: Type.NUMBER,
            description: "Perkiraan jumlah kalori (hanya angka)."
        },
        bahan_utama: {
            type: Type.ARRAY,
            items: {
                type: Type.STRING
            },
            description: "Daftar bahan-bahan utama makanan."
        }
    },
    required: ["nama_makanan", "jumlah_kalori", "bahan_utama"]
};

// Set up a simple endpoint for a health check
app.get('/', (req: Request, res: Response) => {
    res.status(200).send('MyDiet Backend is Running');
});


// Main API endpoint to analyze the food image
app.post('/analyze-food', upload.single('foodImage'), async (req: Request, res: Response) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No image file uploaded.' });
        }

        const model = 'gemini-2.5-flash';

        const prompt = "Analisis gambar makanan ini. Berikan nama makanan, perkiraan jumlah kalori, dan daftar bahan-bahan utamanya. Jika kamu tidak yakin atau gambarnya buram dan tidak jelas, isi nama_makanan dengan tidak_jelas dan deskripsikan gambarnya di bahan_utama.";

        const imagePart = fileToGenerativePart(req.file.buffer, req.file.mimetype);

        // Panggilan API yang Diperbarui dengan Response Schema (Structured Output)
        const result = await genAI.models.generateContent({
            model: model,
            contents: [prompt, imagePart],
            config: {
                // Konfigurasi tambahan untuk memastikan output berformat JSON
                responseMimeType: "application/json",
                responseSchema: foodAnalysisSchema,
            },
        });

        // Output dari API sudah berupa JSON string yang terstruktur
        const jsonText = result.text ? result.text.trim() : '';

        if (!jsonText) {
            // Tangani kasus jika respons model kosong atau undefined
            console.error('Gemini returned an empty or undefined response.');
            return res.status(500).json({ success: false, error: 'Model response was empty.', rawResponse: result });
        }
        try {
            // Langsung parsing teks output
            const parsedData = JSON.parse(jsonText);
            res.json({ success: true, data: parsedData });
        } catch (parseError: unknown) {
            let errorMessage = 'Gagal memparsing respons Gemini sebagai JSON.';
            if (parseError instanceof Error) {
                errorMessage = parseError.message;
            }
            console.error('Failed to parse Gemini response as JSON:', jsonText);
            res.status(500).json({ success: false, error: 'Gagal memparsing respons Gemini.', details: errorMessage, rawResponse: jsonText });
        }
    } catch (error: unknown) {
        let errorMessage = 'Terjadi kesalahan yang tidak diketahui.';
        if (error instanceof Error) {
            errorMessage = error.message;
        }
        console.error('Error analyzing image:', error);
        res.status(500).json({ success: false, error: 'Gagal menganalisis gambar.', details: errorMessage });
    }
});

//Register
app.post("/register", async (req: Request, res: Response) => {
  const { name, email, password } = req.body;

  try {
    // cek input
    if (!name || !email || !password) {
      return res.status(400).json({ error: "Semua field wajib diisi." });
    }

    // cek email sudah ada
    const userExists = await pool.query("SELECT * FROM users WHERE email = $1", [email]);

    if (userExists.rows.length > 0) {
      return res.status(400).json({ error: "Email sudah digunakan." });
    }

    // hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // simpan user
    await pool.query(
      "INSERT INTO users (name, email, password) VALUES ($1, $2, $3)",
      [name, email, hashedPassword]
    );

    res.json({ success: true, message: "Register berhasil." });
    
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error." });
  }
});

app.post("/login", async (req: Request, res: Response) => {
  const { email, password } = req.body;

  try {
    if (!email || !password) {
      return res.status(400).json({ error: "Email dan password wajib diisi." });
    }

    // cek user
    const userQuery = await pool.query("SELECT * FROM users WHERE email = $1", [email]);

    if (userQuery.rows.length === 0) {
      return res.status(400).json({ error: "Email tidak ditemukan." });
    }

    const user = userQuery.rows[0];

    // cek password
    const validPass = await bcrypt.compare(password, user.password);

    if (!validPass) {
      return res.status(400).json({ error: "Password salah." });
    }

    // buat token
    // const token = jwt.sign(
    //   { id: user.id, email: user.email },
    //   process.env.JWT_SECRET!,
    //   { expiresIn: "1d" }
    // );

    res.json({
      success: true,
      message: "Login berhasil.",
      user: {
        id: user.id,
        name: user.name,
        email: user.email
      }
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error." });
  }
});

app.listen(port, () => {
    console.log(`Server is listening at http://localhost:${port}`);
});