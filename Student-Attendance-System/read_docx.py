import zipfile
import xml.etree.ElementTree as ET

def extract_text_from_docx(docx_path):
    try:
        with zipfile.ZipFile(docx_path) as z:
            xml_content = z.read('word/document.xml')
            tree = ET.fromstring(xml_content)
            ns = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
            
            text = []
            for para in tree.findall('.//w:p', ns):
                para_text = []
                for run in para.findall('.//w:r', ns):
                    for t in run.findall('.//w:t', ns):
                        if t.text:
                            para_text.append(t.text)
                text.append(''.join(para_text))
            return '\n'.join(text)
    except Exception as e:
        return str(e)

if __name__ == "__main__":
    text = extract_text_from_docx(r"C:\Users\M_Dell\Downloads\Mini_Project_Synopsis (1).docx")
    with open("synopsis.txt", "w", encoding="utf-8") as f:
        f.write(text)
