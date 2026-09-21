import { WEAVRA_PRODUCT_NAME } from "@t3tools/shared/product";

export const APP_BASE_NAME = WEAVRA_PRODUCT_NAME;
export const APP_STAGE_LABEL = "Dev";
export const APP_DISPLAY_NAME = WEAVRA_PRODUCT_NAME;
// Build identity is used for compatibility and connection metadata, not product presentation.
export const APP_VERSION = import.meta.env.APP_VERSION || "0.0.0";
