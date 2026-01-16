import base64
import hashlib
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.backends import default_backend
import structlog

from services.config import settings

logger = structlog.get_logger()


class EncryptionService:
    """
    Encryption service compatible with admin-backend's EncryptionService.
    Uses AES-256-GCM encryption with the same format.
    """
    
    def __init__(self):
        self.algorithm = 'aes-256-gcm'
        self.key_length = 32
        self.iv_length = 16
        self.auth_tag_length = 16
        
        # Get encryption key from settings
        encryption_key = getattr(settings, 'encryption_key', 'default-encryption-key')
        if len(encryption_key) < self.key_length:
            logger.warning("Encryption key is shorter than recommended 32 bytes")
        
        # Derive key using scrypt (same as Node.js crypto.scryptSync)
        self.key = hashlib.scrypt(
            encryption_key.encode('utf-8'),
            salt=b'salt',  # Same salt as admin-backend
            n=16384,
            r=8,
            p=1,
            dklen=self.key_length
        )
    
    def encrypt(self, text: str) -> str:
        """
        Encrypt a string using AES-256-GCM.
        Returns format: iv:authTag:encrypted (hex)
        """
        import os
        iv = os.urandom(self.iv_length)
        aesgcm = AESGCM(self.key)
        
        # encrypt returns ciphertext + tag
        combined = aesgcm.encrypt(iv, text.encode('utf-8'), None)
        
        # Split combined into encrypted and auth_tag
        # AESGCM in cryptography appends tag to ciphertext
        encrypted = combined[:-self.auth_tag_length]
        auth_tag = combined[-self.auth_tag_length:]
        
        return f"{iv.hex()}:{auth_tag.hex()}:{encrypted.hex()}"
    
    def decrypt(self, ciphertext: str) -> str:
        """
        Decrypt a hex-encoded string separated by colons from admin-backend.
        
        Format: iv:authTag:encrypted (hex)
        """
        try:
            # Handle both formats for backward compatibility during transition if needed
            # but prioritize the colon-separated hex format
            if ':' in ciphertext:
                parts = ciphertext.split(':')
                if len(parts) == 3:
                    iv = bytes.fromhex(parts[0])
                    auth_tag = bytes.fromhex(parts[1])
                    encrypted = bytes.fromhex(parts[2])
                else:
                    raise ValueError("Invalid encrypted text format (expected 3 parts)")
            else:
                # Fallback to old base64 format if no colons
                combined = base64.b64decode(ciphertext)
                iv = combined[:self.iv_length]
                auth_tag = combined[self.iv_length:self.iv_length + self.auth_tag_length]
                encrypted = combined[self.iv_length + self.auth_tag_length:]
            
            # Create AESGCM cipher
            aesgcm = AESGCM(self.key)
            
            # Decrypt (AESGCM.decrypt expects ciphertext + tag concatenated)
            ciphertext_with_tag = encrypted + auth_tag
            plaintext = aesgcm.decrypt(iv, ciphertext_with_tag, None)
            
            return plaintext.decode('utf-8')
            
        except Exception as e:
            logger.error("Decryption failed", error=str(e))
            raise ValueError(f"Failed to decrypt: {str(e)}")


# Singleton instance
encryption_service = EncryptionService()
