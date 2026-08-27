const initialState = {
    // authChecked stays false until the very first /authenticate call answers,
    // so guarded pages don't bounce the user away while we are still asking.
    authChecked: false,
    isAuthenticated: false,
    name: "",
    email: "",
    passwords: []
}

const rootReducer = (state = initialState, action) =>
{
    switch (action.type)
    {
        case "SET_AUTH":
            return {
                ...state,
                isAuthenticated: action.payload,
                authChecked: true
            }

        case "SET_NAME":
            return {
                ...state,
                name: action.payload
            }

        case "SET_EMAIL":
            return {
                ...state,
                email: action.payload
            }

        case "SET_PASSWORDS":
            return {
                ...state,
                passwords: action.payload
            }

        case "DEL_PASS":
            return {
                ...state,
                passwords: state.passwords.filter(password => password._id !== action.payload)
            }


        default:
            return state;
    }
}

export default rootReducer;