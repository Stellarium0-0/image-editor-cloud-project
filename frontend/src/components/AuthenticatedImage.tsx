import React, { useState, useEffect } from 'react';
import api from '../services/api';

interface AuthenticatedImageProps {
  src: string;
  alt: string;
  className?: string;
}

function AuthenticatedImage({ src, alt, className }: AuthenticatedImageProps) {
  const [imgSrc, setImgSrc] = useState<string>('');

  useEffect(() => {
    const fetchImage = async () => {
      try {
        const response = await api.get(src, { responseType: 'blob' });
        const url = URL.createObjectURL(response.data);
        setImgSrc(url);
      } catch (error) {
        console.error('Failed to load authenticated image:', error);
        setImgSrc(''); // Clear src on error
      }
    };

    if (src) {
      fetchImage();
    }

    // Cleanup function to revoke object URL.
    return () => {
      if (imgSrc) {
        URL.revokeObjectURL(imgSrc);
      }
    };
  }, [src]); // Rerun when the src prop changes

  if (!imgSrc) {
    
    return <div className={className} style={{ backgroundColor: '#f0f0f0' }} />;
  }

  return <img src={imgSrc} alt={alt} className={className} />;
}

export default AuthenticatedImage;