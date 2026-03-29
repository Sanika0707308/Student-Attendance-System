import PyInstaller.__main__
import os

if __name__ == '__main__':
    backend_main = os.path.join('python_app', 'main.py')
    
    # In Windows, the separator for add-data is ';'
    frontend_data = 'frontend;frontend'
    
    print("Building STC Attendance System Executable...")
    PyInstaller.__main__.run([
        backend_main,
        '--name=STC_Attendance',
        '--noconsole',      # Hide the terminal window
        '--onefile',        # Create a single .exe
        f'--add-data={frontend_data}',
        '--clean'
    ])
    print("Build complete! Check the /dist folder for your .exe application.")
