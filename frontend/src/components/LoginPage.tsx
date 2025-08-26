import React, { useState, FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import api from '../services/api';

// Step 1: Define an interface for the component's props.
interface LoginPageProps {
  onLogin: (token: string, username: string) => void;
}

// Step 2: Apply the props interface to the component.
function LoginPage({ onLogin }: LoginPageProps) {
  // Step 3: Add explicit types to your state variables.
  const [username, setUsername] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [error, setError] = useState<string>('');
  const navigate = useNavigate();

  // Step 4: Type the form submission event.
  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError('');
    try {
      const response = await api.post('/login', { username, password });
      onLogin(response.data.token, response.data.username);
      navigate('/dashboard');
    } catch (err) {
      setError('Invalid username or password. Please try again.');
      console.error('Login error:', err);
    }
  };

  return (
    <div className="auth-container">
      <h1 className="app-title">My Image Editor ✨</h1>
      <form className="auth-form" onSubmit={handleSubmit}>
        <h2>Welcome Back!</h2>
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
        <button type="submit">Login</button>
        <Link to="/register" className="link">Don't have an account? Sign Up</Link>
      </form>
    </div>
  );
}

export default LoginPage;