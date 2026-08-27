import React, { useEffect } from "react";
import "./App.css";
import { BrowserRouter as Router, Switch, Route, Redirect } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";

import Home from "./Pages/Home/Home";
import Login from "./Pages/Login/Login";
import Signup from "./Pages/SignUp/Signup";
import Passwords from "./Pages/Passwords/Passwords";
import Logout from "./Pages/Logout/Logout";
import Navbar from "./Components/Navbar/Navbar";
import InstallPrompt from "./Components/InstallPrompt/InstallPrompt";

import { setAuth, setName, setEmail, setPasswords } from "./redux/actions";
import { checkAuthenticated } from "./axios/instance";

function App() {
  const isAuthenticated = useSelector((state) => state.isAuthenticated);
  const dispatch = useDispatch();

  useEffect(() => {
    let cancelled = false;

    const verifyUser = async () => {
      try {
        const res = await checkAuthenticated();

        if (cancelled) return;

        if (res.status !== 200) {
          dispatch(setAuth(false));
          return;
        }

        const { name, email, passwords } = res.data;
        dispatch(setAuth(true));
        dispatch(setName(name));
        dispatch(setEmail(email));
        dispatch(setPasswords(passwords));
      } catch (error) {
        if (!cancelled) dispatch(setAuth(false));
      }
    };

    verifyUser();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, dispatch]);

  return (
    <div className="App">
      <Router>
        <Navbar />

        <Switch>
          <Route exact path="/"><Home /></Route>
          <Route exact path="/signin"><Login /></Route>
          <Route exact path="/signup"><Signup /></Route>
          <Route exact path="/passwords"><Passwords /></Route>
          <Route exact path="/logout"><Logout /></Route>
          <Route path="*"><Redirect to="/" /></Route>
        </Switch>

        <InstallPrompt />
      </Router>
    </div>
  );
}

export default App;
