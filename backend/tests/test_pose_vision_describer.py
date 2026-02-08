from services.pose_vision_describer import _extract_prompt_text


def test_extract_prompt_text_returns_plain_text_as_is():
    text = (
        "Створи зображення людини в студії, із чітко визначеною позою на "
        "зображені. Задній фон 100% білий, без декорів та аксесуарів."
    )
    assert _extract_prompt_text(text) == text


def test_extract_prompt_text_unwraps_action_input_json_string():
    raw = (
        '{'
        '"action":"dalle.text2im",'
        '"action_input":"{\\"prompt\\": \\"A realistic full-body studio photo.\\"}"'
        '}'
    )
    assert _extract_prompt_text(raw) == "A realistic full-body studio photo."


def test_extract_prompt_text_unwraps_markdown_json_payload():
    raw = """```json
{
  "prompt": "A realistic full-body studio photo on a pure white background."
}
```"""
    assert (
        _extract_prompt_text(raw)
        == "A realistic full-body studio photo on a pure white background."
    )


def test_extract_prompt_text_extracts_prompt_english_blockquote():
    raw = """
Ось кілька варіантів промптів.

### Варіант 1
**Prompt (English):**
> **A realistic full-body studio photo of a woman practicing yoga on a clean floor. The background is 100% solid pure white.**
"""
    assert (
        _extract_prompt_text(raw)
        == "A realistic full-body studio photo of a woman practicing yoga on a clean floor. The background is 100% solid pure white."
    )
