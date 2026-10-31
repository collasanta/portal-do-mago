// Procedural pixel art for the Salão do Grimório. Everything is drawn in code; no external assets.

// Avatars live in ./avatar (Habbo-style sprites); re-exported here for existing imports.
export {
  AV_AX, AV_AY, AV_H, AV_HEAD, AV_W, DEFAULT_LOOK, DIR_S, FRAME_SIT, GLASSES, HAIRS, HAIR_STYLES, HATS, PANTS, SHIRTS, SHOES,
  SKINS, TOPS, BOTTOMS, anyAvatarFrame, atlasStats, avatarFrame, blitSprite, avatarTop, drawAvatarSprite, onAtlasLost, resetAvatarAtlas, setSpriteBudget, dirFromScreen, drawTyping, normLook, randomLook, typingBubble,
} from "./avatar";
export type { Dir, Look, NpcKind, SpriteRef } from "./avatar";

// ---------------------------------------------------------------- room (floor, walls, furni, lights)
export * from "./room-art";
