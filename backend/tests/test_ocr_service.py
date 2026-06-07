import unittest

from app.mybvlife_recovery.ocr_service import _has_minimum_data, _normalize_field_text, _parse_cccd_qr, _parse_ocr_data, _parse_ocr_lines, _validate_data


class CccdParsingTest(unittest.TestCase):
    def test_field_ocr_normalizes_common_digit_misreads(self) -> None:
        self.assertEqual(_normalize_field_text("O561 72O1 O4O1", "identity_no"), "056172010401")
        self.assertEqual(_normalize_field_text("225 214 726", "old_id_no"), "225214726")

    def test_field_ocr_strips_name_label_without_changing_accents(self) -> None:
        self.assertEqual(_normalize_field_text("Ho va ten Nguyá»…n Thá»‹ ThÃ¹y Trang", "full_name"), "Nguyá»…n Thá»‹ ThÃ¹y Trang")

    def test_parse_zalo_labeled_lines_keeps_full_vietnamese_name(self) -> None:
        data = _parse_ocr_lines(
            [
                "Số CCCD",
                "0340 6900 8775",
                "Số CMND",
                "225 813 563",
                "Họ và tên",
                "Nguyễn Công Tuấn",
            ]
        )

        self.assertEqual(data["fullName"], "Nguyễn Công Tuấn")
        self.assertEqual(data["cccd"], "034069008775")
        self.assertEqual(data["cmnd"], "225813563")

    def test_parse_qr_prefers_structured_fields(self) -> None:
        data = _parse_cccd_qr("034069008775|225813563|Nguyễn Công Tuấn|01011990|Nam|Hà Nội|01012021")

        self.assertEqual(data["fullName"], "Nguyễn Công Tuấn")
        self.assertEqual(data["cccd"], "034069008775")
        self.assertEqual(data["cmnd"], "225813563")

    def test_two_word_name_gets_warning(self) -> None:
        warnings = _validate_data({"fullName": "Công Tuấn", "cccd": "034069008775", "cmnd": "225813563"})

        self.assertIn("Họ tên có thể bị thiếu, vui lòng kiểm tra lại", warnings)

    def test_choose_fuller_name_when_multiple_ocr_passes_disagree(self) -> None:
        data = _parse_ocr_lines(
            [
                "Số CCCD",
                "0340 6900 8775",
                "Số CMND",
                "225 813 563",
                "Họ và tên",
                "Công Tuấn",
                "Giới tính",
                "Họ và tên",
                "Nguyễn Công Tuấn",
                "Giới tính",
            ]
        )

        self.assertEqual(data["fullName"], "Nguyễn Công Tuấn")

    def test_normalize_common_middle_name_tone_mark(self) -> None:
        data = _parse_ocr_lines(
            [
                "Số CCCD",
                "0561 9400 7129",
                "Số CMND",
                "225 700 711",
                "Họ và tên",
                "Võ Thi Minh Diễm",
            ]
        )

        self.assertEqual(data["fullName"], "Võ Thị Minh Diễm")
        self.assertEqual(data["cccd"], "056194007129")
        self.assertEqual(data["cmnd"], "225700711")

    def test_reject_ui_text_as_person_name_and_use_surname_fallback(self) -> None:
        data = _parse_ocr_lines(
            [
                "Thông tin Căn cước công dân",
                "Số CCCD",
                "0562 0200 4379",
                "Số CMND",
                "225 772 872",
                "Họ và tên",
                "Ngày Thông tin",
                "Giới tính",
                "Nguyễn Văn Pháp",
            ]
        )

        self.assertEqual(data["fullName"], "Nguyễn Văn Pháp")
        self.assertEqual(data["cccd"], "056202004379")
        self.assertEqual(data["cmnd"], "225772872")

    def test_never_accept_header_text_as_person_name(self) -> None:
        data = _parse_ocr_lines(
            [
                "Số CCCD",
                "0562 0200 4379",
                "Số CMND",
                "225 772 872",
                "Họ và tên",
                "Ngày Thông tin",
                "Giới tính",
            ]
        )

        self.assertEqual(data["fullName"], "")

    def test_bad_name_does_not_count_as_minimum_data(self) -> None:
        self.assertFalse(_has_minimum_data({"fullName": "Ngày Thông tin", "cccd": "056202004379", "cmnd": "225772872"}))

    def test_parse_name_from_line_below_ho_va_ten_using_position(self) -> None:
        def token(text: str, x1: float, y1: float, x2: float, y2: float):
            return {"text": text, "x1": x1, "y1": y1, "x2": x2, "y2": y2, "cx": (x1 + x2) / 2, "cy": (y1 + y2) / 2}

        lines = [
            "Thông tin Căn cước công dân",
            "Số CCCD",
            "0560 8300 4847",
            "Số CMND",
            "225 171 161",
            "Họ và tên",
            "Giới tính",
            "Nam",
            "Ngày sinh",
            "03/04/1983",
        ]
        tokens = [
            token("Số CCCD", 48, 190, 150, 216),
            token("0560 8300 4847", 48, 224, 285, 258),
            token("Số CMND", 48, 282, 160, 308),
            token("225 171 161", 48, 318, 210, 350),
            token("Họ và tên", 48, 360, 150, 388),
            token("Ngô Minh Quân", 48, 394, 260, 430),
            token("Giới tính", 48, 444, 150, 472),
            token("Nam", 48, 480, 105, 510),
            token("Ngày sinh", 320, 444, 440, 472),
            token("03/04/1983", 320, 480, 470, 510),
        ]

        data = _parse_ocr_data(lines, tokens)

        self.assertEqual(data["fullName"], "Ngô Minh Quân")
        self.assertEqual(data["cccd"], "056083004847")
        self.assertEqual(data["cmnd"], "225171161")

    def test_prepend_split_surname_when_name_starts_with_middle_name(self) -> None:
        def token(text: str, x1: float, y1: float, x2: float, y2: float):
            return {"text": text, "x1": x1, "y1": y1, "x2": x2, "y2": y2, "cx": (x1 + x2) / 2, "cy": (y1 + y2) / 2}

        lines = [
            "Số CCCD",
            "0561 8501 0645",
            "Số CMND",
            "225 278 369",
            "Họ và tên",
            "Thị Thanh Tuyền",
        ]
        tokens = [
            token("Số CCCD", 48, 190, 150, 216),
            token("0561 8501 0645", 48, 224, 285, 258),
            token("Số CMND", 48, 282, 160, 308),
            token("225 278 369", 48, 318, 210, 350),
            token("Họ và tên", 48, 360, 150, 388),
            token("Tống", 48, 394, 104, 430),
            token("Thị Thanh Tuyền", 112, 394, 300, 430),
        ]

        data = _parse_ocr_data(lines, tokens)

        self.assertEqual(data["fullName"], "Tống Thị Thanh Tuyền")
        self.assertEqual(data["cccd"], "056185010645")
        self.assertEqual(data["cmnd"], "225278369")


if __name__ == "__main__":
    unittest.main()
