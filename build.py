import PyInstaller.__main__
import os
import shutil

if __name__ == '__main__':
    backend_main = os.path.join('python_app', 'main.py')
    
    # In Windows, the separator for add-data is ';'
    frontend_data = 'frontend;frontend'
    
    # Clean previous builds
    print("Cleaning old builds...")
    for folder in ['build', 'dist']:
        if os.path.exists(folder):
            shutil.rmtree(folder)
            
    hidden_imports = [
        'uvicorn',
        'fastapi',
        'sqlalchemy',
        'pydantic',
        'pydantic.deprecated.decorator',
        'sqlite3',
        'email.mime',
        'email.mime.multipart',
        'email.mime.text',
        'structlog',
        'cryptography'
    ]
    
    hidden_imports_args = []
    for inc in hidden_imports:
        hidden_imports_args.extend(['--hidden-import', inc])
    
    print("Building Enterprise Architecture - EXE (Standalone Mode)...")
    PyInstaller.__main__.run([
        backend_main,
        '--name=InstituteAttendance',
        '--noconsole',      # Hide the terminal window
        '--onefile',        # Create a single .exe
        f'--add-data={frontend_data}',
        '--clean'
    ] + hidden_imports_args)
    
    print("Build complete! Check the /dist/InstituteAttendance folder.")
    print("You can now compile `installer.iss` using Inno Setup to create the professional Setup.exe.")
