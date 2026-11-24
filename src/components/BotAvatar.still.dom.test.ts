// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { stillFrameUrl } from "@/lib/still-frame";
import { BotAvatar, type BotAvatarProps } from "./Avatar";

const stills = vi.hoisted(() => new Map<string, string | null>());
vi.mock("@/lib/still-frame", () => ({
  peekStill: (url: string) => stills.get(url),
  stillFrameUrl: vi.fn(async (url: string) => {
    const still = url.endsWith(".gif") ? "blob:still-of-gif" : null;
    stills.set(url, still);
    return still;
  }),
}));

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
  stills.clear();
  vi.mocked(stillFrameUrl).mockClear();
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

  it("holds still while the bot waits on the person, though busy stays true", async () => {
    expect((await draw({ busy: true, activity: "waiting-on-you" })).src()).toBe("blob:still-of-gif");
    expect((await draw({ busy: true, activity: "waiting-on-you" }, { working: true })).src()).toBe("blob:still-of-gif");
    const avatar = await draw({ busy: true, activity: "working" });
    expect(avatar.src()).toBe(GIF);
    await avatar.show({ busy: true, activity: "waiting-on-you" });
    expect(avatar.src()).toBe("blob:still-of-gif");
  });

  it("starts still when a known GIF mounts again, with no moving frame first", async () => {
    await draw({});
    const html = renderToStaticMarkup(createElement(BotAvatar, { bot: { color: "green", avatarUrl: GIF, avatarCrop: "circle" } }));
    expect(html).toContain('src="blob:still-of-gif"');
    const playing = renderToStaticMarkup(createElement(BotAvatar, { bot: { color: "green", avatarUrl: GIF, avatarCrop: "circle", busy: true } }));
    expect(playing).toContain(`src="${GIF}"`);
  });

  it("makes no still for a bot that wears its mascot instead of the picture", async () => {
    await draw({ avatarCrop: "mascot" });
    expect(stillFrameUrl).not.toHaveBeenCalled();
  });

  it("leaves a picture that does not move exactly as it was", async () => {
    const avatar = await draw({ avatarUrl: "/api/attachments/bot.png" });
    expect(avatar.src()).toBe("/api/attachments/bot.png");
  });
});
