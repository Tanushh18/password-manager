import React from 'react';
import { Link } from 'react-router-dom';
import "./Home.css";
import { useSelector } from "react-redux";

function Home() {
    const { name, isAuthenticated } = useSelector(state => state);

    return (
        <div className="home">
            <div className="home__container">
                <div className="home__content">
                    {!isAuthenticated ? (
                        <>
                            <div className="home__icon">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                                    <circle cx="12" cy="16" r="1"/>
                                    <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                                </svg>
                            </div>
                            
                            <h1 className="home__title">
                                Welcome to <span className="name">SecureVault</span>
                            </h1>
                            
                            <p className="home__subtitle">
                                Your trusted companion for secure password management
                            </p>
                            
                            <Link to="/signup" className="home__cta">
                                Get Started
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M5 12h14M12 5l7 7-7 7"/>
                                </svg>
                            </Link>
                        </>
                    ) : (
                        <>
                            <div className="home__welcome">
                                <div className="home__avatar">
                                    {name.charAt(0).toUpperCase()}
                                </div>
                                
                                <h1 className="home__title">
                                    Welcome back, <span className="name">{name}</span>
                                </h1>
                                
                                <p className="home__subtitle">
                                    Ready to manage your passwords securely?
                                </p>
                                
                                <Link to="/passwords" className="home__cta">
                                    View Passwords
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <path d="M5 12h14M12 5l7 7-7 7"/>
                                    </svg>
                                </Link>
                            </div>
                        </>
                    )}
                </div>
                
                <div className="home__background">
                    <div className="home__circle home__circle--1"></div>
                    <div className="home__circle home__circle--2"></div>
                    <div className="home__circle home__circle--3"></div>
                </div>
            </div>
        </div>
    );
}

export default Home;