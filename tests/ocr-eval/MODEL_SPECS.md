# Official model specifications consulted

Documentation snapshot: 2026-11-18. These are specifications for the official open-source model releases, not for the hosted OCR API. The API documentation does not identify its backend model or promise parity with either release.

| Model | Published input modes | Published prompts relevant to this suite | Other model-card details |
|---|---|---|---|
| `deepseek-ai/DeepSeek-OCR` | Tiny 512×512 (64 vision tokens); Small 640×640 (100); Base 1024×1024 (256); Large 1280×1280 (400); dynamic “Gundam”: `n×640×640 + 1×1024×1024` | Document to Markdown; grounded OCR; Free OCR; parse figure; describe image; locate a `<|ref|>…</|ref|>` target | 3B parameters, BF16. The model card gives an NVIDIA GPU tested stack; its environment is implementation context, not an API requirement. |
| `deepseek-ai/DeepSeek-OCR-2` | Dynamic default: `(0–6)×768×768 + 1×1024×1024`, described as `(0–6)×144 + 256` visual tokens | Document to Markdown; Free OCR | 3B parameters, BF16; Apache-2.0 model card. The README gives a Transformers example with `base_size=1024`, `image_size=768`, `crop_mode=True`. |

The optional matrices test only documented prompt/settings combinations. They do not assert that one model is more accurate, that the API endpoint routes to either model, or that all model outputs follow the OCR API response schema.

## Official sources

- [DeepSeek-OCR README](https://github.com/deepseek-ai/DeepSeek-OCR), sections “Support-Modes” and “Prompts examples”.
- [DeepSeek-OCR model card](https://huggingface.co/deepseek-ai/DeepSeek-OCR), usage and model metadata.
- [DeepSeek-OCR-2 README](https://github.com/deepseek-ai/DeepSeek-OCR-2), sections “Support-Modes” and “Main Prompts”.
- [DeepSeek-OCR-2 model card](https://huggingface.co/deepseek-ai/DeepSeek-OCR-2), usage and model metadata.

The OCR-1 README includes a final bare Chinese phrase example (`先天下之忧而忧`) without an instruction or expected result. It is marked ambiguous in `coverage.csv` rather than assigned an invented test.
