import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { app } from "../src/app.js";
import { setMockActionGenerator } from "../src/services/llm.service.js";
import type { PageContext } from "../../shared/types/index.js";

describe("Stage 2: AgentTask Continuation Tests (Requirements A - L)", () => {
  let server: http.Server;
  let baseUrl: string;

  before(async () => {
    server = http.createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const address = server.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
  });

  after(async () => {
    setMockActionGenerator(null);
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  beforeEach(() => {
    setMockActionGenerator(null);
  });

  /**
   * Helper to register a test user and obtain the persistent session cookie.
   */
  async function registerTestUser(emailPrefix: string) {
    const email = `${emailPrefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}@example.com`;
    const password = "StrongPassword123!";

    const response = await fetch(`${baseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    assert.equal(response.status, 201, "Registration should succeed with 201");
    const cookieHeader = response.headers.get("set-cookie");
    assert.ok(cookieHeader, "Session cookie must be set on registration");

    const cookiePart = cookieHeader.split(";")[0];
    assert.ok(cookiePart, "Cookie value must be present");
    const sessionCookie: string = cookiePart;
    const data = await response.json();

    return {
      userId: data.user.id as string,
      email: data.user.email as string,
      cookie: sessionCookie,
    };
  }

  // Requirement B: unauthenticated user receives 401
  it("Requirement B: unauthenticated user receives 401 on /continue", async () => {
    const response = await fetch(`${baseUrl}/api/agent/tasks/dummy-task-id/continue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pageContext: {
          url: "https://example.com/step-2",
          title: "Step 2",
          text: "Text",
          elements: [],
        },
      }),
    });

    assert.equal(response.status, 401);
    const data = await response.json();
    assert.equal(data.authenticated, false);
  });

  // Requirements A & G: authenticated user can continue their own running task; normal action keeps status = running
  it("Requirements A & G: authenticated user can continue their own running task; status remains running", async () => {
    const user = await registerTestUser("stage2-user-a");

    setMockActionGenerator(async () => ({
      action: "click",
      target: "start-btn",
    }));

    const startRes = await fetch(`${baseUrl}/api/agent/tasks`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: user.cookie,
      },
      body: JSON.stringify({
        command: "Start job application",
        pageContext: {
          url: "https://example.com/start",
          title: "Start",
          text: "Welcome",
          elements: [{ id: "start-btn", type: "button", text: "Start" }],
        },
      }),
    });
    const startData = await startRes.json();
    const taskId = startData.task.id;
    assert.equal(startData.task.status, "running");

    // Continue with new page
    setMockActionGenerator(async () => ({
      action: "type",
      target: "name-field",
      value: "Alex Johnson",
    }));

    const continueRes = await fetch(`${baseUrl}/api/agent/tasks/${taskId}/continue`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: user.cookie,
      },
      body: JSON.stringify({
        pageContext: {
          url: "https://example.com/step-2",
          title: "Step 2 Form",
          text: "Enter your name",
          elements: [{ id: "name-field", type: "input", label: "Full Name" }],
        },
      }),
    });

    assert.equal(continueRes.status, 200);
    const continueData = await continueRes.json();
    assert.equal(continueData.success, true);
    assert.equal(continueData.task.id, taskId);
    assert.equal(continueData.task.status, "running");
    assert.deepEqual(continueData.action, {
      action: "type",
      target: "name-field",
      value: "Alex Johnson",
    });
  });

  // Requirement C: user cannot continue another user's task
  it("Requirement C: user cannot continue another user's task (HTTP 403)", async () => {
    const userA = await registerTestUser("stage2-owner");
    const userB = await registerTestUser("stage2-attacker");

    setMockActionGenerator(async () => ({
      action: "click",
      target: "first-btn",
    }));

    const startRes = await fetch(`${baseUrl}/api/agent/tasks`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: userA.cookie,
      },
      body: JSON.stringify({
        command: "User A command",
        pageContext: {
          url: "https://example.com",
          title: "Initial",
          text: "Text",
          elements: [{ id: "first-btn", type: "button", text: "First" }],
        },
      }),
    });
    const { task } = await startRes.json();

    const continueRes = await fetch(`${baseUrl}/api/agent/tasks/${task.id}/continue`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: userB.cookie,
      },
      body: JSON.stringify({
        pageContext: {
          url: "https://example.com/step-2",
          title: "Next",
          text: "Text",
          elements: [],
        },
      }),
    });

    assert.equal(continueRes.status, 403);
    const data = await continueRes.json();
    assert.equal(data.success, false);
    assert.ok(data.error.includes("Access denied"));
  });

  // Requirements D & E: continuation uses the NEW PageContext; targeting element in NEW PageContext succeeds
  it("Requirements D & E: continuation uses the NEW PageContext and succeeds for new elements", async () => {
    const user = await registerTestUser("stage2-new-context");

    setMockActionGenerator(async () => ({
      action: "click",
      target: "landing-btn",
    }));

    const startRes = await fetch(`${baseUrl}/api/agent/tasks`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: user.cookie,
      },
      body: JSON.stringify({
        command: "Proceed through portal",
        pageContext: {
          url: "https://example.com/landing",
          title: "Landing Page",
          text: "Click below to begin",
          elements: [{ id: "landing-btn", type: "button", text: "Begin" }],
        },
      }),
    });
    const { task } = await startRes.json();

    let capturedPrompt = "";
    setMockActionGenerator(async (prompt) => {
      capturedPrompt = prompt;
      return {
        action: "type",
        target: "ssn-last4",
        value: "1234",
      };
    });

    const newPageContext: PageContext = {
      url: "https://example.com/verification",
      title: "Identity Verification",
      text: "Please verify identity",
      elements: [{ id: "ssn-last4", type: "input", placeholder: "Last 4 digits" }],
    };

    const continueRes = await fetch(`${baseUrl}/api/agent/tasks/${task.id}/continue`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: user.cookie,
      },
      body: JSON.stringify({
        pageContext: newPageContext,
      }),
    });

    assert.equal(continueRes.status, 200);
    const data = await continueRes.json();
    assert.equal(data.success, true);
    assert.deepEqual(data.action, {
      action: "type",
      target: "ssn-last4",
      value: "1234",
    });

    // Requirement D: verify prompt used the NEW pageContext
    assert.ok(
      capturedPrompt.includes("https://example.com/verification"),
      "Prompt must feature the NEW page URL"
    );
    assert.ok(
      capturedPrompt.includes("ssn-last4"),
      "Prompt must feature the NEW page elements"
    );
  });

  // Requirement F: Gemini action targeting an element only present on the OLD page is rejected
  it("Requirement F: action targeting an element only present on the OLD page is rejected by semantic validation", async () => {
    const user = await registerTestUser("stage2-old-target");

    setMockActionGenerator(async () => ({
      action: "click",
      target: "old-apply-button",
    }));

    const startRes = await fetch(`${baseUrl}/api/agent/tasks`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: user.cookie,
      },
      body: JSON.stringify({
        command: "Submit application",
        pageContext: {
          url: "https://example.com/page-1",
          title: "Page 1",
          text: "Initial page",
          elements: [{ id: "old-apply-button", type: "button", text: "Apply Now" }],
        },
      }),
    });
    const { task } = await startRes.json();

    // AI hallucinates and tries to click old-apply-button, but page 2 does not have it
    setMockActionGenerator(async () => ({
      action: "click",
      target: "old-apply-button",
    }));

    const continueRes = await fetch(`${baseUrl}/api/agent/tasks/${task.id}/continue`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: user.cookie,
      },
      body: JSON.stringify({
        pageContext: {
          url: "https://example.com/page-2",
          title: "Page 2",
          text: "Next page with different form",
          elements: [{ id: "new-submit-button", type: "button", text: "Final Submit" }],
        },
      }),
    });

    assert.equal(continueRes.status, 400);
    const data = await continueRes.json();
    assert.equal(data.success, false);
    assert.ok(
      data.error.includes("old-apply-button"),
      "Error must indicate that the old target does not exist in the current page context"
    );
  });

  // Requirement H: done changes status = completed
  it("Requirement H: done changes status to completed", async () => {
    const user = await registerTestUser("stage2-done");

    setMockActionGenerator(async () => ({
      action: "click",
      target: "step-1-btn",
    }));

    const startRes = await fetch(`${baseUrl}/api/agent/tasks`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: user.cookie,
      },
      body: JSON.stringify({
        command: "Complete workflow",
        pageContext: {
          url: "https://example.com/step-1",
          title: "Step 1",
          text: "Step 1",
          elements: [{ id: "step-1-btn", type: "button", text: "Step 1" }],
        },
      }),
    });
    const { task } = await startRes.json();

    setMockActionGenerator(async () => ({
      action: "done",
    }));

    const continueRes = await fetch(`${baseUrl}/api/agent/tasks/${task.id}/continue`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: user.cookie,
      },
      body: JSON.stringify({
        pageContext: {
          url: "https://example.com/success",
          title: "Application Received",
          text: "Thank you for applying",
          elements: [],
        },
      }),
    });

    assert.equal(continueRes.status, 200);
    const data = await continueRes.json();
    assert.equal(data.success, true);
    assert.equal(data.task.status, "completed");
    assert.deepEqual(data.action, { action: "done" });
  });

  // Requirement I: ask_user changes status = waiting_for_user
  it("Requirement I: ask_user changes status to waiting_for_user", async () => {
    const user = await registerTestUser("stage2-ask");

    setMockActionGenerator(async () => ({
      action: "click",
      target: "step-1-btn",
    }));

    const startRes = await fetch(`${baseUrl}/api/agent/tasks`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: user.cookie,
      },
      body: JSON.stringify({
        command: "Fill application",
        pageContext: {
          url: "https://example.com/step-1",
          title: "Step 1",
          text: "Step 1",
          elements: [{ id: "step-1-btn", type: "button", text: "Step 1" }],
        },
      }),
    });
    const { task } = await startRes.json();

    setMockActionGenerator(async () => ({
      action: "ask_user",
      question: "What is your target hourly rate?",
    }));

    const continueRes = await fetch(`${baseUrl}/api/agent/tasks/${task.id}/continue`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: user.cookie,
      },
      body: JSON.stringify({
        pageContext: {
          url: "https://example.com/salary-form",
          title: "Compensation",
          text: "Rate expectation",
          elements: [],
        },
      }),
    });

    assert.equal(continueRes.status, 200);
    const data = await continueRes.json();
    assert.equal(data.success, true);
    assert.equal(data.task.status, "waiting_for_user");
    assert.equal(data.action.action, "ask_user");
    assert.equal(data.action.question, "What is your target hourly rate?");
  });

  // Requirement J: completed task cannot continue (and waiting_for_user cannot continue)
  it("Requirement J: completed and waiting_for_user tasks cannot continue (HTTP 400)", async () => {
    const user = await registerTestUser("stage2-completed-guard");

    // 1. Create a task that immediately completes
    setMockActionGenerator(async () => ({
      action: "done",
    }));

    const startRes = await fetch(`${baseUrl}/api/agent/tasks`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: user.cookie,
      },
      body: JSON.stringify({
        command: "Already complete job",
        pageContext: {
          url: "https://example.com/done",
          title: "Done",
          text: "Done text",
          elements: [],
        },
      }),
    });
    const { task } = await startRes.json();
    assert.equal(task.status, "completed");

    // Attempt to continue completed task
    const continueRes = await fetch(`${baseUrl}/api/agent/tasks/${task.id}/continue`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: user.cookie,
      },
      body: JSON.stringify({
        pageContext: {
          url: "https://example.com/more",
          title: "More",
          text: "Text",
          elements: [],
        },
      }),
    });

    assert.equal(continueRes.status, 400);
    const data = await continueRes.json();
    assert.equal(data.success, false);
    assert.ok(data.error.includes("already completed"));

    // 2. Create a task in waiting_for_user state
    setMockActionGenerator(async () => ({
      action: "ask_user",
      question: "Are you authorized to work in the US?",
    }));

    const askRes = await fetch(`${baseUrl}/api/agent/tasks`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: user.cookie,
      },
      body: JSON.stringify({
        command: "Ask question task",
        pageContext: {
          url: "https://example.com/auth",
          title: "Auth",
          text: "Text",
          elements: [],
        },
      }),
    });
    const askData = await askRes.json();
    assert.equal(askData.task.status, "waiting_for_user");

    // Attempt to continue without responding to question
    const continueWaitingRes = await fetch(`${baseUrl}/api/agent/tasks/${askData.task.id}/continue`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: user.cookie,
      },
      body: JSON.stringify({
        pageContext: {
          url: "https://example.com/auth-bypass",
          title: "Bypass",
          text: "Text",
          elements: [],
        },
      }),
    });

    assert.equal(continueWaitingRes.status, 400);
    const waitingData = await continueWaitingRes.json();
    assert.equal(waitingData.success, false);
    assert.ok(waitingData.error.includes("waiting for user response"));
  });

  // Requirement K: existing Stage 1 tests still pass
  it("Requirement K: Stage 1 task creation still works as expected", async () => {
    const user = await registerTestUser("stage2-stage1-verify");

    setMockActionGenerator(async () => ({
      action: "click",
      target: "stage1-btn",
    }));

    const response = await fetch(`${baseUrl}/api/agent/tasks`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: user.cookie,
      },
      body: JSON.stringify({
        command: "Create stage 1 task",
        pageContext: {
          url: "https://example.com/stage1",
          title: "Stage 1",
          text: "Content",
          elements: [{ id: "stage1-btn", type: "button", text: "Stage 1" }],
        },
      }),
    });

    assert.equal(response.status, 201);
    const data = await response.json();
    assert.equal(data.success, true);
    assert.equal(data.task.status, "running");
    assert.deepEqual(data.action, { action: "click", target: "stage1-btn" });
  });

  // Requirement L: existing /api/agent/act compatibility endpoint still works
  it("Requirement L: existing /api/agent/act endpoint still works as expected", async () => {
    const user = await registerTestUser("stage2-act-verify");

    setMockActionGenerator(async () => ({
      action: "scroll",
      direction: "down",
    }));

    const response = await fetch(`${baseUrl}/api/agent/act`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: user.cookie,
      },
      body: JSON.stringify({
        command: "Scroll down to see more jobs",
        pageContext: {
          url: "https://example.com/jobs",
          title: "Job Board",
          text: "List of openings",
          elements: [],
        },
      }),
    });

    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.success, true);
    assert.deepEqual(data.action, { action: "scroll", direction: "down" });
  });
});
