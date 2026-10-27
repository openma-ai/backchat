import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SessionMessages } from "./SessionMessages";

describe("SessionMessages", () => {
  it("renders parent and child rows as chat bubbles without UUID chrome", () => {
    const html = renderToStaticMarkup(
      <SessionMessages
        childAcpSessionId="child-acp"
        messages={[
          {
            messageId: "m1",
            senderSessionId: "parent-acp",
            recipientSessionId: "child-acp",
            content: [{ type: "text", text: "Please audit" }],
          },
          {
            messageId: "m2",
            senderSessionId: "child-acp",
            recipientSessionId: "parent-acp",
            content: [{ type: "text", text: "CHILD_RFD_OK" }],
          },
        ]}
      />,
    );
    expect(html).toContain('data-session-message-role="user"');
    expect(html).toContain('data-session-message-role="assistant"');
    expect(html).toContain("Please audit");
    expect(html).toContain("CHILD_RFD_OK");
    expect(html).not.toContain("parent-acp → child-acp");
    expect(html).not.toContain("→");
  });

  it("hides settlement text already shown in the turn transcript", () => {
    const html = renderToStaticMarkup(
      <SessionMessages
        childAcpSessionId="child-acp"
        hideTexts={["CHILD_RFD_OK"]}
        messages={[
          {
            messageId: "m2",
            senderSessionId: "child-acp",
            recipientSessionId: "parent-acp",
            content: [{ type: "text", text: "CHILD_RFD_OK" }],
          },
        ]}
      />,
    );
    expect(html).toBe("");
  });
});
