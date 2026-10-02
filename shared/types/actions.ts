export type AgentAction =
  | {
      action: "navigate";
      url: string;
    }
  | {
      action: "click";
      target: string;
    }
  | {
      action: "type";
      target: string;
      value: string;
    }
  | {
      action: "scroll";
      direction: "up" | "down";
    }
  | {
      action: "read";
      target?: string;
    }
  | {
      action: "ask_user";
      question: string;
    }
  | {
      action: "done";
    };