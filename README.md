# Welcome to your Lovable project

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Open your project in the [Lovable editor](https://lovable.dev) and keep building.

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: connect the project to GitHub and every change made in Lovable is committed straight to your repository.
- **Full ownership**: this code is yours. Push to your repository and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

## Built with

- TanStack Start
- TypeScript
- React
- Tailwind CSS


## Groq API setup

The Resume Matcher sends the extracted resume text and pasted job description to Groq **from the server**, so the API key is not placed in the browser.

1. Create a `.env` file in the project root by copying `.env.example`.
2. Add your Groq key:
   `GROQ_API_KEY=your_real_key_here`
3. Leave `GROQ_MODEL=openai/gpt-oss-120b` unless your Groq account uses another active model.
4. Restart the development server after changing `.env`.

The analysis returns:
- overall match percentage
- skill, experience, keyword, education, and project scores
- matched and partially matched skills with evidence
- missing required/preferred skills
- missing and important ATS keywords
- potentially unwanted/low-relevance skills already in the resume
- ATS readability findings
- prioritized suggestions and final action tips

The API key is read only on the server in `src/lib/resume-match.functions.ts`. Do not commit `.env` or expose `GROQ_API_KEY` in client-side code.
