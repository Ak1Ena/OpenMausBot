// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BotAvatar, type BotAvatarProps } from "./Avatar";

vi.mock("@/lib/still-frame", () => ({ stillFrameUrl: vi.fn(async (url: string) => (url.endsWith(".gif") ? "blob:still-of-gif" : null)) }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const GIF = "/api/attachments/bot.gif";
const roots: ReturnType<typeof createRoot>[] = [];

async function draw(bot: Partial<BotAvatarProps["bot"]>, props: Partial<BotAvatarProps> = {}) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  const show = async (next: Partial<BotAvatarProps["bot"]>, nextProps: Partial<BotAvatarProps> = props) => {
    await act(async () => root.render(createElement(BotAvatar, { bot: { color: "green", avatarUrl: GIF, avatarCrop: "circle", ...next }, ...nextProps })));
  };
  await show(bot);
  return { show, src: () => host.querySelector("img")!.getAttribute("src") };
}

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

describe("an uploaded GIF avatar", () => {
  it("holds on its first frame while the bot is not working", async () => {
    const avatar = await draw({});
    expect(avatar.src()).toBe("blob:still-of-gif");
  });

  it("plays the original while the bot is busy, and stills again when it stops", async () => {
    const avatar = await draw({ busy: true });
    expect(avatar.src()).toBe(GIF);
    await avatar.show({ busy: false });
    expect(avatar.src()).toBe("blob:still-of-gif");
    await avatar.show({ busy: true });
    expect(avatar.src()).toBe(GIF);
  });

  it("keeps the still when the caller only lets the mascot move (a beat or an unread notice)", async () => {
    expect((await draw({}, { animated: true })).src()).toBe("blob:still-of-gif");
    expect((await draw({}, { animated: true, motion: "celebrate", motionKey: 1 })).src()).toBe("blob:still-of-gif");
    expect((await draw({}, { animated: true, state: "notifying" })).src()).toBe("blob:still-of-gif");
  });

  it("keeps the still when the face only looks busy (stateForBot guesses it from the bot's name)", async () => {
    expect((await draw({}, { state: "working" })).src()).toBe("blob:still-of-gif");
    expect((await draw({}, { state: "thinking", animated: true })).src()).toBe("blob:still-of-gif");
  });

  it("plays when the caller says the bot is working, and stills when it stops", async () => {
    const avatar = await draw({}, { working: true });
    expect(avatar.src()).toBe(GIF);
    await avatar.show({}, { working: false });
    expect(avatar.src()).toBe("blob:still-of-gif");
  });

  it("lets a busy bot play even where the list keeps its mascot calm", async () => {
    expect((await draw({ busy: true }, { animated: false })).src()).toBe(GIF);
  });

  it("leaves a picture that does not move exactly as it was", async () => {
    const avatar = await draw({ avatarUrl: "/api/attachments/bot.png" });
    expect(avatar.src()).toBe("/api/attachments/bot.png");
  });
});
