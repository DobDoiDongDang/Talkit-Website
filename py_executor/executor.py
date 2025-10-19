from fastapi import FastAPI
from pydantic import BaseModel
import subprocess, tempfile, os

app = FastAPI()

class CodeRequest(BaseModel):
    code: str

@app.post("/run")
def run_code(req: CodeRequest):
    with tempfile.NamedTemporaryFile(suffix=".py", delete=False) as tmp:
        tmp.write(req.code.encode('utf-8'))
        tmp_path = tmp.name

    result = subprocess.run(["python3", tmp_path], capture_output=True, text=True, timeout=3)
    os.remove(tmp_path)

    return {"result": result.stdout + result.stderr}
