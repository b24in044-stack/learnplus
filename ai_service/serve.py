import os

import uvicorn


def main() -> None:
    port = int(os.environ.get("PORT", "8100"))
    uvicorn.run("ai_service.app.main:app", host="0.0.0.0", port=port)


if __name__ == "__main__":
    main()
