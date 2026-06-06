import unittest

from app.mybvlife_recovery.ai_vision_ocr import _extract_json_object, normalize_ai_data, validate_ai_data


class AiVisionOcrTest(unittest.TestCase):
    def test_extract_json_from_markdown_response(self) -> None:
        data = _extract_json_object('```json\n{"fullName":"Nguyễn Công Tuấn","cccd":"0340 6900 8775","cmnd":"225 813 563"}\n```')

        self.assertEqual(data["fullName"], "Nguyễn Công Tuấn")

    def test_normalize_expected_sample_data(self) -> None:
        data = normalize_ai_data({"fullName": " Nguyễn Công Tuấn ", "cccd": "0340 6900 8775", "cmnd": "225 813 563"})
        ok, warnings = validate_ai_data(data)

        self.assertTrue(ok)
        self.assertEqual(warnings, [])
        self.assertEqual(data, {"fullName": "Nguyễn Công Tuấn", "cccd": "034069008775", "cmnd": "225813563"})

    def test_normalize_second_expected_sample_data(self) -> None:
        data = normalize_ai_data({"fullName": "Nguyễn Thị Thanh Tuyền", "cccd": "056185010645", "cmnd": "225278369"})
        ok, warnings = validate_ai_data(data)

        self.assertTrue(ok)
        self.assertEqual(warnings, [])
        self.assertEqual(data, {"fullName": "Nguyễn Thị Thanh Tuyền", "cccd": "056185010645", "cmnd": "225278369"})

    def test_warn_when_two_word_name_starts_with_middle_name(self) -> None:
        data = normalize_ai_data({"fullName": "Thị Tuyền", "cccd": "056185010645", "cmnd": "225278369"})
        ok, warnings = validate_ai_data(data)

        self.assertTrue(ok)
        self.assertIn("Họ tên có thể bị thiếu họ, vui lòng kiểm tra lại.", warnings)


if __name__ == "__main__":
    unittest.main()
