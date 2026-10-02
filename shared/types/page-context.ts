export interface PageElement {
  id: string;
  type:
    | "button"
    | "input"
    | "textarea"
    | "select"
    | "link"
    | "heading"
    | "text";

  text?: string;
  label?: string;
  placeholder?: string;
  value?: string;
}

export interface PageContext {
  url: string;
  title: string;
  text: string;
  elements: PageElement[];
}