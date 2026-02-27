import React, { useEffect, useState } from "react";
import { useHistory } from "react-router";
import Password from "../../Components/Password/Password";
import "./Passwords.css";
import "react-responsive-modal/styles.css";
import { Modal } from "react-responsive-modal";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import { saveNewPassword, checkAuthenticated } from "../../axios/instance";
import { useSelector, useDispatch } from "react-redux";
import { setAuth, setPasswords } from "../../redux/actions";
import * as XLSX from "xlsx";

function Passwords() {
  const [platform, setPlatform] = useState("");
  const [platEmail, setPlatEmail] = useState("");
  const [platPass, setPlatPass] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [newPass, setNewPass] = useState("");
  const [open, setOpen] = useState(false);

  const history = useHistory();
  const { isAuthenticated, name, email, passwords } = useSelector(
    (state) => state
  );
  const dispatch = useDispatch();

  // ✅ CLEAN FUNCTION (Fixes Excel hidden spaces)
  const clean = (val) => {
    if (!val) return "";
    return val
      .toString()
      .replace(/\u00A0/g, "")
      .replace(/\s+/g, " ")
      .trim();
  };

  const verifyUser = async () => {
    try {
      const res = await checkAuthenticated();
      if (res.status === 400) {
        dispatch(setAuth(false));
      } else {
        dispatch(setPasswords(res.data.passwords));
      }
    } catch (error) {
      console.log(error);
    }
  };

  // ✅ ADD PASSWORD
  const addNewPassword = async (e) => {
    e.preventDefault();

    const data = {
      platform: clean(platform),
      userPass: clean(platPass),
      platEmail: clean(platEmail),
      userEmail: clean(email),
    };

    if (!data.platform || !data.userPass || !data.platEmail) {
      toast.error("All fields are required");
      return;
    }

    try {
      const res = await saveNewPassword(data);

      if (res.status === 200) {
        setOpen(false);
        verifyUser();
        toast.success(res.data.message);
        setPlatform("");
        setPlatEmail("");
        setPlatPass("");
      }
    } catch (error) {
      console.log(error);
      toast.error("Failed to add password");
    }
  };

  // ✅ EXCEL UPLOAD (FIXED)
  const handleExcelUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();

    reader.onload = async (e) => {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: "array" });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json(worksheet);

      for (const row of jsonData) {
        const cleanedData = {
          platform: clean(row.platform || row.Platform),
          userPass: clean(
            row.userPass || row.password || row.Password
          ),
          platEmail: clean(
            row.platEmail || row.email || row.Email
          ),
          userEmail: clean(email),
        };

        if (
          !cleanedData.platform ||
          !cleanedData.userPass ||
          !cleanedData.platEmail
        ) {
          console.log("Skipping invalid row:", row);
          continue;
        }

        try {
          await saveNewPassword(cleanedData);
        } catch (err) {
          console.error("Error saving row:", row, err);
        }
      }

      verifyUser();
      toast.success("Bulk passwords uploaded successfully");
    };

    reader.readAsArrayBuffer(file);
  };

  useEffect(() => {
    !isAuthenticated && history.replace("/signin");
  }, [isAuthenticated, history]);

  return (
    <div style={{ minHeight: "100vh", padding: "2rem" }}>
      <ToastContainer />

      <button onClick={() => setOpen(true)}>Add Password</button>

      <label>
        Upload Excel
        <input
          type="file"
          accept=".xlsx, .xls"
          style={{ display: "none" }}
          onChange={handleExcelUpload}
        />
      </label>

      <Modal open={open} onClose={() => setOpen(false)}>
        <form onSubmit={addNewPassword}>
          <input
            type="text"
            placeholder="Platform"
            value={platform}
            onChange={(e) => setPlatform(e.target.value)}
          />
          <input
            type="text"
            placeholder="Email"
            value={platEmail}
            onChange={(e) => setPlatEmail(e.target.value)}
          />
          <input
            type="password"
            placeholder="Password"
            value={platPass}
            onChange={(e) => setPlatPass(e.target.value)}
          />
          <button type="submit">Save</button>
        </form>
      </Modal>

      <div>
        {passwords?.map((data) => (
          <Password
            key={data._id}
            id={data._id}
            name={data.platform}
            password={data.password}
            email={data.platEmail}
            iv={data.iv}
          />
        ))}
      </div>
    </div>
  );
}

export default Passwords;
