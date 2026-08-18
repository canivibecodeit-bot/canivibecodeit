/* Launch flags for the builds vertical. Unset = the whole surface is
   invisible (pages 404, APIs 404, sections unrendered) and the site renders
   byte-identical to before the feature existed. Flipping is a Railway env
   change, never a deploy. */

const on = (name) => ['1', 'true'].includes(process.env[name]);

export const buildsLive = () => on('BUILDS_LIVE');
