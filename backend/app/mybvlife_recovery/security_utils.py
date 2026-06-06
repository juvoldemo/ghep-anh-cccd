def mask_identity_no(identity_no: str) -> str:
    digits = "".join(ch for ch in identity_no if ch.isdigit())
    if len(digits) <= 6:
        return "*" * len(digits)
    return f"{digits[:4]}{'*' * max(len(digits) - 6, 0)}{digits[-2:]}"
