# Portrait Generator

A small local web app that takes a single neutral portrait image, generates seven additional emotional variants using the OpenAI Images API, then outputs a single eight-portrait sheet.

- **Input:** 1 image (any common format)
- **Output:** 1 PNG sheet, 576×288, arranged 4 across × 2 down, each tile 144×144
- Runs locally on your computer, your image files never leave your machine

---

## What it does

1. You drag and drop a neutral portrait into the page
2. The app generates these eight emotions:
   - Neutral
   - Happy
   - Serious / Determined
   - Angry
   - Sad
   - Surprised
   - Thinking / Concerned
   - Embarrassed
3. It saves a single PNG sheet to your chosen output folder

---

## Requirements

- Windows, macOS, or Linux
- Node.js 20 or newer recommended (Node 18 may work, 20 is safest)

Check your Node version:

```bash
node -v
```

---

## Install

### 1. Download the project

- Click the green **Code** button on GitHub
- Choose **Download ZIP**
- Unzip it somewhere on your machine, for example:

```
C:\dev\portrait-generator
```

### 2. Install dependencies

This creates the `node_modules` folder.

Open a terminal in the project folder and run:

```bash
npm install
```

---

## Get an OpenAI API key

This app requires your own OpenAI API key.  
The key is stored only on your computer in a local `.env` file.

1. Log in to your OpenAI account
2. Go to the API keys section of the dashboard
3. Create a new secret key
4. Copy the key somewhere safe

Important: do not commit your API key to GitHub or share it publicly.

---

## Configure your API key

In the project folder, create a file named `.env`.

You can copy the example file:

### Windows (PowerShell)

```powershell
copy .env.example .env
```

### macOS / Linux

```bash
cp .env.example .env
```

Now open `.env` in a text editor and set:

```env
OPENAI_API_KEY=your_key_here
PORT=5177
```

Save the file.

---

## Run the app

Start the local server:

```bash
npm start
```

Then open your browser to:

```
http://localhost:5177
```

---

## How to use

1. Enter an output folder path  
   Example (Windows):

```
C:\dev\portrait-output
```

2. Drag and drop your neutral portrait image into the app
3. Click **Generate**
4. Watch the status updates as each emotion is generated
5. The final PNG sheet will be written into your output folder

The output folder value is remembered by your browser between sessions.

---

## Troubleshooting

### Missing OPENAI_API_KEY

Your `.env` file is missing or the key is blank.  
Make sure `.env` exists and contains:

```env
OPENAI_API_KEY=...
```

---

### Output folder validation fails

Make sure the folder exists or that the app has permission to create it.  
Try using a folder inside your user directory.

---

### Generated portraits do not match the original style closely

AI generation can vary.

For best results:
- Use a clean, front-facing neutral portrait
- Keep the background simple
- Avoid strong lighting or extreme expressions in the base image

You can regenerate as needed.

---

## Security notes

- Your OpenAI API key stays on your machine in `.env`
- `.env` is ignored by git via `.gitignore`
- This app runs locally and is intended for personal or small-scale use

---

## License

Add a license if you plan to share broadly.  
MIT is a common choice for open source tools.
