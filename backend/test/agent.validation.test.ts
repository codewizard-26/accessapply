import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { AgentAction, PageContext } from "../../shared/types/index.js";
import { validateActionAgainstPageContext } from "../src/agent/agent.service.js";

const mockPageContext: PageContext = {
  url: "https://example.com/jobs/123",
  title: "Frontend Developer",
  text: "Job description for Frontend Developer.",
  elements: [
    {
      id: "apply-button",
      type: "button",
      text: "Apply Now",
    },
    {
      id: "email-input",
      type: "input",
      label: "Email Address",
      placeholder: "user@example.com",
    },
    {
      id: "job-details",
      type: "text",
      text: "Responsibilities and benefits",
    },
  ],
};

describe("Agent Page-Context Semantic Validation", () => {
  it("allows a valid click action targeting an element by id", () => {
    const action: AgentAction = {
      action: "click",
      target: "apply-button",
    };

    assert.doesNotThrow(() => {
      validateActionAgainstPageContext(action, mockPageContext);
    });
  });

  it("allows a valid click action targeting an element by text", () => {
    const action: AgentAction = {
      action: "click",
      target: "Apply Now",
    };

    assert.doesNotThrow(() => {
      validateActionAgainstPageContext(action, mockPageContext);
    });
  });

  it("allows a valid type action targeting an existing input", () => {
    const action: AgentAction = {
      action: "type",
      target: "email-input",
      value: "applicant@example.com",
    };

    assert.doesNotThrow(() => {
      validateActionAgainstPageContext(action, mockPageContext);
    });
  });

  it("allows a valid type action targeting an input by label or placeholder", () => {
    const actionByLabel: AgentAction = {
      action: "type",
      target: "Email Address",
      value: "applicant@example.com",
    };

    const actionByPlaceholder: AgentAction = {
      action: "type",
      target: "user@example.com",
      value: "applicant@example.com",
    };

    assert.doesNotThrow(() => {
      validateActionAgainstPageContext(actionByLabel, mockPageContext);
      validateActionAgainstPageContext(actionByPlaceholder, mockPageContext);
    });
  });

  it("allows ask_user action without page element targets", () => {
    const action: AgentAction = {
      action: "ask_user",
      question: "Are you authorized to work in the US?",
    };

    assert.doesNotThrow(() => {
      validateActionAgainstPageContext(action, mockPageContext);
    });
  });

  it("allows navigate, scroll, and done actions without page element targets", () => {
    const navigateAction: AgentAction = {
      action: "navigate",
      url: "https://example.com/jobs",
    };
    const scrollAction: AgentAction = {
      action: "scroll",
      direction: "down",
    };
    const doneAction: AgentAction = {
      action: "done",
    };

    assert.doesNotThrow(() => {
      validateActionAgainstPageContext(navigateAction, mockPageContext);
      validateActionAgainstPageContext(scrollAction, mockPageContext);
      validateActionAgainstPageContext(doneAction, mockPageContext);
    });
  });

  it("rejects click action targeting an invalid/missing page element", () => {
    const action: AgentAction = {
      action: "click",
      target: "non-existent-button",
    };

    assert.throws(
      () => {
        validateActionAgainstPageContext(action, mockPageContext);
      },
      {
        message:
          'Invalid agent target: "non-existent-button" does not exist in the current page context.',
      }
    );
  });

  it("rejects type action targeting an invalid/missing page element", () => {
    const action: AgentAction = {
      action: "type",
      target: "phone-number-field",
      value: "1234567890",
    };

    assert.throws(
      () => {
        validateActionAgainstPageContext(action, mockPageContext);
      },
      {
        message:
          'Invalid agent target: "phone-number-field" does not exist in the current page context.',
      }
    );
  });
});
