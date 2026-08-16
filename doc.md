# Oobee Accessibility Automation Challenge

## Background
The Oobee team's vision is for all government digital services to be inclusive and accessible, regardless of a person's ability or disability. As part of our central initiative, we support government digital teams by providing resources, tools, and technical capabilities to embed accessibility throughout their products. 

## The Scenario
We are building a fictitious internal portal codenamed **Project EquiCheck**. This tool allows product teams to test specific web pages or HTML snippets for accessibility compliance. 

Your task is to build a simplified version of this portal. The application should scan a target webpage for bugs using automated testing frameworks like [Playwright](https://playwright.dev/) and [axe-core](https://github.com/dequelabs/axe-core). Because understanding accessibility violations can be difficult for newer developers, the portal must include an AI assistant to explain the issues found in the HTML.

## Core Requirements

### 1. Frontend (React.js / Vite)
*   **Framework:** Build a Single Page Application using modern software development practices with React.js and Vite. You may use TypeScript or Node.js/JavaScript.
*   **UI/UX:** Neatly present the accessibility scan results (e.g., WCAG 2.2 violations) using React accordions or tabs. 
*   **AI Integration:** For each violation displayed, include a chat button labeled **"Get help"**.

### 2. Backend (Node.js)
*   **Framework:** Create a TypeScript/Node.js backend to handle the automation and API requests.
*   **Automation:** Integrate Playwright and Axe-Core (`@axe-core/playwright`) to run a headless scan on a user-provided URL. 
*   **LLM Service:** When the user clicks the "Get help" button on the frontend, the backend should send the offending HTML snippet and the Axe-core violation data to an LLM. The LLM should act as an accessibility expert, checking the HTML code for issues and explaining the problem and potential fixes to the user.
    *   *Note on LLMs:* Any standard LLM model from the cloud (e.g., OpenAI, Gemini, Claude) is suitable. Basic evaluations and guardrails are sufficient for this assignment.

### 3. Documentation & Decision Making
*   Include a comprehensive `README.md` in your final repository. 
*   Document your technical trade-offs, architecture decisions, and how you approached quality standards. 
*   Include instructions on how to run the application and any required environment variables (e.g., API keys).

## Time Expectation & Effort
Given that developers now code with the assistance of LLMs, the expected effort for this assignment is applicable for **3 half-day effort**. Please do not over-engineer; focus on a reliable, working prototype that demonstrates your grasp of accessibility, automation, and full-stack integration.

## Submission Instructions
1. Save your app solution in a Git repository.
2. Share the repository with the GitHub user **`younglim`**.
3. Reply to your recruiter's email with the link to your repository once completed.
