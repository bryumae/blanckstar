// Physical constants (mvp0_spec.md §4.3, §8.2). SI units.
export const C = 299_792_458; // m/s, speed of light

export const MU_SUN = 1.32712440018e20; // m^3/s^2
export const MU_EARTH = 3.986004418e14; // m^3/s^2
export const MU_MOON = 4.9048695e12; // m^3/s^2

export const R_EARTH = 6_371_000; // m
export const R_MOON = 1_737_400; // m
export const R_SUN = 6.9634e8; // m
export const R_SOI_EARTH = 0.929e9; // m

export const AU = 1.495978707e11; // m

export const SHIP_MASS_KG = 12_000;
export const MAX_ACCELERATION = 0.5; // m/s^2

export const MIN_SAFE_ALTITUDE = 120_000; // m, below this the ship burns up (§2.2)
