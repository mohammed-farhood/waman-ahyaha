---
trigger: model_decision
description: when only the model used is one of the following :1- gemeni 3.1 pro (high) 2-claude sonnet 4.6 (thinking) 3-claude opus 4.6 (thinking).. and not activated when gemeni 3 flash or gemeni 3.1 pro (low) is activated  
---

---
name: verify-and-learn
description: A self-evolving verification skill that forces the AI to check code accuracy and update its own logic based on new lessons.
version: 1.1
---

# Skill: Self-Correction & Verification (Meta-CoVe Pattern)

## 1. Pre-Task Verification (The "Think Twice" Phase)
Before outputting any code, you must perform an internal "Negotiation." 
- **Identify Options:** If a task can be done in multiple ways (e.g., using `Fetch API` vs `Axios`), list **Option A** and **Option B**.
- **Reasoning:** Explain why you chose the winner. Format: "I chose A because [reason], whereas B would have [downside]."
- **Skill Level Alignment:** Ensure the code is accessible for an **Intermediate** developer. Avoid "over-engineering" unless explicitly asked.

## 2. The Verification Loop (Meta CoVe)
For every block of logic, you must generate and answer these 3 internal "Verification Questions":
1. **Consistency Check:** Does this code actually use the variables I defined 10 lines ago?
2. **Edge Case Check:** What happens if the API returns a 404 or the input is empty?
3. **Dependency Check:** Are these libraries/APIs compatible with the user's current environment?

> [!IMPORTANT]
> If any verification answer is "I'm not sure," you MUST use the `search` tool or ask the user for clarification before providing the final code.

## 3. Post-Action Learning (The "Memory" Phase)
You are authorized and ENCOURAGED to update this section of the file. 
Whenever the user corrects you, or you discover a "best practice" for this specific project (e.g., "In this app, we prioritize performance over readability"), you must append it to the **Learning Registry** below.

### [LEARNING REGISTRY]
* **Lesson 001:** Always prioritize quality over price/speed in this project.
* **Lesson 002:** Always define CSS variable aliases when using semantic names (e.g., `--error` alongside `--danger`). The app code may use different naming conventions than the CSS design system.
* **Lesson 003:** When adding new icons used in templates, always verify they exist in `icons.js` BEFORE deploying. Missing icon references render as "undefined" text.
* **Lesson 004:** Cards with absolute-positioned children MUST have `position: relative` on the parent container.
* **Lesson 005:** Always bump script `?v=` parameters in `index.html` when making CSS/JS changes to prevent browser caching.
* **Lesson 006:** Never commit `.env` with secrets. Always add `.gitignore` before first push.
* **Lesson 007:** The agent environment is sandboxed and cannot initialize local PostgreSQL databases (due to `shmget` shared memory restrictions). End-to-end backend testing requiring DB connections must be run by the user.

## 4. Teaching Intent
Do not just provide code. Provide the "Why." 
- Explain the **Access** (How the API is called).
- Explain the **Logic** (Why this loop is better than a map here).
- Use analogies if it helps an intermediate learner grasp "Agentic" concepts.


# let the user do the visual testing upon your guidance to save tokens , unless he asks you to do , or you want to see inspect consol things other than normal ux of visuals only !