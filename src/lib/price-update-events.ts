/**
 * A window event, not a state store: the Settings page saves the refresh
 * settings, but the timer that honours them lives in the root layout and stays
 * mounted across navigation. The page fires this event after a successful save
 * so the timer can re-read its interval without a full page reload.
 *
 * Kept in its own module so neither side has to import the other's component.
 */
export const PRICE_SETTINGS_CHANGED_EVENT = "portfolio:price-settings-changed";
