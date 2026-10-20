/**
 * Reviewed, release-time public feature asset registry.
 *
 * Add a directory and its exact filenames here when approving a new static
 * feature. Never enumerate an entire writable directory at runtime or accept
 * arbitrary extensions: everything shipped must be explicitly reviewed in Git.
 * The image pack itself lives at apps/web/public/<directory>/.
 *
 * This is not a user-upload area; custom album artwork stays in private
 * authenticated storage rather than the public build.
 */
export const approvedFeatureAssets: Record<string, readonly string[]> = {
  'freeqify-covers': [
    'generic_01_sunset_ridge.jpg',
    'generic_02_smoke_portrait.jpg',
    'generic_03_shoreline_tide.jpg',
    'generic_04_neon_halo.jpg',
    'generic_05_lunar_eclipse.jpg',
    'generic_06_morning_leaves.jpg',
    'generic_07_vinyl_warmth.jpg',
    'generic_08_iridescent_silk.jpg',
    'generic_09_rainy_metropolis.jpg',
    'generic_10_peach_clouds.jpg',
    'generic_11_moonlit_doorway.jpg',
    'generic_12_dune_waves.jpg',
    'generic_13_night_garden.jpg',
    'generic_14_alpine_light.jpg',
    'generic_15_deep_water.jpg',
    'generic_16_cosmic_bloom.jpg',
    'generic_17_prism_orb.jpg',
  ],
};
