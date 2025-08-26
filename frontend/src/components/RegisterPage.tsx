import React, { useState, FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { AxiosError } from 'axios';
import api from '../services/api';

function RegisterPage() {
  // Add explicit types to state variables
  const [username, setUsername] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [message, setMessage] = useState<string>('');
  const [error, setError] = useState<string>('');
  const navigate = useNavigate();

  // Type the form submission event
  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError('');
    setMessage('');

    try {
      await api.post('/register', { username, password });
      setMessage('Account created successfully! Redirecting to login...');
      setTimeout(() => navigate('/login'), 2000);
    } catch (err) {
      // Type the error object for safer property access
      const axiosError = err as AxiosError;
      if (axiosError.response && axiosError.response.status === 409) {
        setError('Username is already taken.');
      } else {
        setError('Failed to create account. Please try again.');
      }
      console.error('Registration error:', err);
    }
  };

  return (
    <div className="auth-container">
      <h1 className="app-title">My Image Editor ✨</h1>
      <form className="auth-form" onSubmit={handleSubmit}>
        <h2>Create an Account</h2>
        <input
          type="text"
          placeholder="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        {error && <p className="error-message">{error}</p>}
        {message && <p style={{ color: 'green' }}>{message}</p>}
        <button type="submit">Register</button>
        <Link to="/login" className="link">Already have an account? Log In</Link>
      </form>
    </div>
  );
}

export default RegisterPage;