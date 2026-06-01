#!/usr/bin/env python3
"""
Completar resúmenes vacíos en Supabase - Motor Jurisprudencial
Estudio Castro - Dr. Javier Horacio Castro (CPACF T°102 F°174)

Uso:
    python3 scripts/completar_resumenes_supabase.py \
        --sb-url https://TU_PROJECT.supabase.co \
        --sb-key sb_secret_... \
        --ant-key sk-ant-api03-...

O con variables de entorno:
    SUPABASE_URL=... SUPABASE_KEY=... ANTHROPIC_KEY=... python3 scripts/completar_resumenes_supabase.py
"""

import sys
import os
import argparse
import requests
from typing import Optional, List, Dict


class ResumenUpdater:
    def __init__(self, sb_url: str, sb_key: str, ant_key: str):
        self.sb_url = sb_url.rstrip("/")
        self.sb_key = sb_key
        self.ant_key = ant_key
        self.processed = []
        self.errors = []

    def fetch_records(self) -> List[Dict]:
        """Obtiene registros con resúmenes vacíos o con texto genérico."""
        TEXTOS_VACIOS = ["", "Documento cargado desde Telegram"]
        headers = {
            "apikey": self.sb_key,
            "Authorization": f"Bearer {self.sb_key}",
        }
        resp = requests.get(
            f"{self.sb_url}/rest/v1/jurisprudencia",
            headers=headers,
            params={"select": "id,titulo,DRIVE_URL,resumen_doctrina", "order": "id"},
            timeout=15,
        )
        resp.raise_for_status()
        data = resp.json()
        return [
            r for r in data
            if not r.get("resumen_doctrina")
            or r.get("resumen_doctrina", "").strip() in TEXTOS_VACIOS
        ]

    def read_drive_content(self, drive_url: str) -> Optional[str]:
        """Intenta leer el contenido de un archivo de Google Drive."""
        if not drive_url:
            return None
        # Extrae el file ID de la URL de Drive
        import re
        match = re.search(r"/d/([a-zA-Z0-9_-]+)", drive_url)
        if not match:
            return None
        file_id = match.group(1)
        export_url = f"https://docs.google.com/document/d/{file_id}/export?format=txt"
        try:
            resp = requests.get(export_url, timeout=15)
            if resp.status_code == 200 and len(resp.text.strip()) > 50:
                return resp.text[:3000]
        except Exception:
            pass
        return None

    def generate_summary(self, titulo: str, contenido: Optional[str] = None) -> Optional[str]:
        """Genera resumen jurídico con Claude."""
        if contenido and len(contenido.strip()) > 50:
            prompt = (
                f"Sos abogado laboralista argentino. "
                f"Resumí en máximo 200 caracteres el siguiente fallo judicial:\n\n"
                f"TÍTULO: {titulo}\n\nCONTENIDO:\n{contenido[:2000]}\n\n"
                f"Solo el resumen, sin explicaciones adicionales."
            )
        else:
            prompt = (
                f"Sos abogado laboralista argentino. "
                f"En base al título del fallo, generá un resumen jurídico en máximo 200 caracteres:\n\n"
                f"TÍTULO: {titulo}\n\n"
                f"Solo el resumen, sin explicaciones adicionales."
            )

        resp = requests.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "Content-Type": "application/json",
                "x-api-key": self.ant_key,
                "anthropic-version": "2023-06-01",
            },
            json={
                "model": "claude-opus-4-7",
                "max_tokens": 300,
                "messages": [{"role": "user", "content": prompt}],
            },
            timeout=30,
        )
        resp.raise_for_status()
        data = resp.json()
        if data.get("content"):
            return data["content"][0]["text"].strip()
        return None

    def update_supabase(self, record_id: int, resumen: str) -> bool:
        """Actualiza resumen_doctrina en Supabase."""
        headers = {
            "apikey": self.sb_key,
            "Authorization": f"Bearer {self.sb_key}",
            "Content-Type": "application/json",
        }
        resp = requests.patch(
            f"{self.sb_url}/rest/v1/jurisprudencia?id=eq.{record_id}",
            headers=headers,
            json={"resumen_doctrina": resumen},
            timeout=15,
        )
        return resp.status_code in [200, 204]

    def process(self):
        """Procesa todos los registros pendientes."""
        records = self.fetch_records()
        if not records:
            print("[*] Sin registros para actualizar. Todo está al día.")
            return

        print(f"\n[*] Procesando {len(records)} registro(s) con resumen vacío\n")
        for rec in records:
            print(f"[{rec['id']}] {rec['titulo'][:60]}...")
            contenido = self.read_drive_content(rec.get("DRIVE_URL", ""))
            resumen = self.generate_summary(rec["titulo"], contenido)
            if not resumen:
                print("  [!] Error generando resumen")
                self.errors.append(rec["id"])
                continue
            print(f"  [+] {resumen[:80]}...")
            if self.update_supabase(rec["id"], resumen):
                print("  [OK]\n")
                self.processed.append(rec["id"])
            else:
                print("  [!] Error actualizando Supabase\n")
                self.errors.append(rec["id"])

    def report(self):
        print("=" * 60)
        print(f"Actualizados: {len(self.processed)} | Errores: {len(self.errors)}")
        if self.errors:
            print(f"IDs con error: {self.errors}")
        print("=" * 60)


def main():
    parser = argparse.ArgumentParser(description="Completar resúmenes vacíos en Supabase")
    parser.add_argument("--sb-url", default=os.getenv("SUPABASE_URL"), help="URL del proyecto Supabase")
    parser.add_argument("--sb-key", default=os.getenv("SUPABASE_KEY"), help="Service Role Key de Supabase")
    parser.add_argument("--ant-key", default=os.getenv("ANTHROPIC_KEY"), help="API Key de Anthropic")
    args = parser.parse_args()

    if not all([args.sb_url, args.sb_key, args.ant_key]):
        print("[!] Faltan credenciales. Usá --sb-url, --sb-key y --ant-key (o variables de entorno).")
        sys.exit(1)

    updater = ResumenUpdater(args.sb_url, args.sb_key, args.ant_key)
    updater.process()
    updater.report()


if __name__ == "__main__":
    main()
