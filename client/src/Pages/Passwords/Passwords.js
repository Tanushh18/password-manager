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

  // ✅ CLEAN FUNCTION (removes hidden Excel spaces)
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
        const { passwords } = res.data;
        dispatch(setPasswords(passwords));
      }
    } catch (error) {
      console.log(error);
    }
  };

  const addNewPassword = async (e) => {
    e.preventDefault();
    try {
      const data = {
        platform: clean(platform) || "NA",
        userPass: clean(platPass) || "NA",
        platEmail: clean(platEmail) || "NA",
        userEmail: clean(email),
      };

      const res = await saveNewPassword(data);

      if (res.status === 400) {
        toast.error(res.data.error, { position: "top-right" });
      } else if (res.status === 200) {
        setOpen(false);
        verifyUser();
        toast.success(res.data.message, { position: "top-right" });

        setPlatform("");
        setPlatEmail("");
        setPlatPass("");
      }
    } catch (error) {
      console.log(error);
    }
  };

  const handleEditPassword = async (id, platform, platEmail) => {
    try {
      const data = {
        platform: clean(platform) || "NA",
        userPass: clean(newPass) || "NA",
        platEmail: clean(platEmail) || "NA",
        userEmail: clean(email),
      };

      const res = await saveNewPassword(data);
      if (res.status === 200) {
        toast.success("Password updated");
        setEditingId(null);
        verifyUser();
      }
    } catch (err) {
      console.error(err);
    }
  };

  // ✅ UPDATED EXCEL UPLOAD (Auto-fill NA, no skipping)
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
        const payload = {
          platform: clean(row.platform || row.Platform) || "NA",
          userPass:
            clean(row.userPass || row.password || row.Password) || "NA",
          platEmail:
            clean(row.platEmail || row.email || row.Email) || "NA",
          userEmail: clean(email),
        };

        try {
          await saveNewPassword(payload);
        } catch (err) {
          console.error("Error saving row:", row, err);
        }
      }

      verifyUser();
      toast.success("Bulk passwords uploaded", {
        position: "top-right",
        autoClose: 5000,
      });
    };

    reader.readAsArrayBuffer(file);
  };

  useEffect(() => {
    !isAuthenticated && history.replace("/signin");
  }, [isAuthenticated, history]);

   return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', padding: '2rem', fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif" }}>
      <ToastContainer />
      
      {/* Header Section */}
      <div style={{ maxWidth: '1200px', margin: '0 auto', marginBottom: '3rem' }}>
        <div style={{ background: 'rgba(255,255,255,0.1)', backdropFilter: 'blur(20px)', borderRadius: '24px', padding: '2rem', border: '1px solid rgba(255,255,255,0.2)', boxShadow: '0 8px 32px rgba(0,0,0,0.1)' }}>
          <h1 style={{ fontSize: '2.5rem', fontWeight: '700', color: 'white', margin: '0', textAlign: 'center', letterSpacing: '-0.025em' }}>
            Welcome back, <span style={{ background: 'linear-gradient(45deg, #ff6b6b, #feca57)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>{name}</span>
          </h1>
        </div>
      </div>

      {/* Action Buttons */}
      <div style={{ maxWidth: '1200px', margin: '0 auto', marginBottom: '2rem' }}>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', justifyContent: 'center' }}>
          <button 
            onClick={() => setOpen(true)}
            style={{ background: 'linear-gradient(45deg, #667eea, #764ba2)', color: 'white', border: 'none', borderRadius: '16px', padding: '1rem 2rem', fontSize: '1rem', fontWeight: '600', cursor: 'pointer', transition: 'all 0.3s ease', boxShadow: '0 4px 16px rgba(102,126,234,0.3)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
            onMouseEnter={(e) => { e.target.style.transform = 'translateY(-2px)'; e.target.style.boxShadow = '0 8px 24px rgba(102,126,234,0.4)'; }}
            onMouseLeave={(e) => { e.target.style.transform = 'translateY(0)'; e.target.style.boxShadow = '0 4px 16px rgba(102,126,234,0.3)'; }}
          >
            ➕ Add Password
          </button>
          
          <label style={{ background: 'linear-gradient(45deg, #48cae4, #0077b6)', color: 'white', border: 'none', borderRadius: '16px', padding: '1rem 2rem', fontSize: '1rem', fontWeight: '600', cursor: 'pointer', transition: 'all 0.3s ease', boxShadow: '0 4px 16px rgba(72,202,228,0.3)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                 onMouseEnter={(e) => { e.target.style.transform = 'translateY(-2px)'; e.target.style.boxShadow = '0 8px 24px rgba(72,202,228,0.4)'; }}
                 onMouseLeave={(e) => { e.target.style.transform = 'translateY(0)'; e.target.style.boxShadow = '0 4px 16px rgba(72,202,228,0.3)'; }}>
            📊 Upload Excel
            <input type="file" accept=".xlsx, .xls" style={{ display: "none" }} onChange={handleExcelUpload} />
          </label>
        </div>
      </div>

      {/* Search Bar */}
      <div style={{ maxWidth: '800px', margin: '0 auto', marginBottom: '2rem' }}>
        <div style={{ position: 'relative' }}>
          <input
            type="text"
            placeholder="🔍 Search by platform..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{ width: '100%', padding: '1.25rem 1.5rem', fontSize: '1.1rem', border: 'none', borderRadius: '20px', background: 'rgba(255,255,255,0.9)', backdropFilter: 'blur(10px)', boxShadow: '0 8px 32px rgba(0,0,0,0.1)', outline: 'none', transition: 'all 0.3s ease', boxSizing: 'border-box' }}
            onFocus={(e) => { e.target.style.background = 'rgba(255,255,255,1)'; e.target.style.boxShadow = '0 12px 40px rgba(0,0,0,0.15)'; }}
            onBlur={(e) => { e.target.style.background = 'rgba(255,255,255,0.9)'; e.target.style.boxShadow = '0 8px 32px rgba(0,0,0,0.1)'; }}
          />
        </div>
      </div>

      {/* Modal */}
      <Modal 
        open={open} 
        onClose={() => setOpen(false)}
        styles={{
          modal: { background: 'rgba(255,255,255,0.95)', backdropFilter: 'blur(20px)', borderRadius: '24px', border: '1px solid rgba(255,255,255,0.3)', boxShadow: '0 20px 60px rgba(0,0,0,0.2)', padding: '0', maxWidth: '500px', width: '90%' }
        }}
      >
        <div style={{ padding: '2rem' }}>
          <h2 style={{ fontSize: '1.8rem', fontWeight: '700', color: '#2d3748', margin: '0 0 2rem 0', textAlign: 'center' }}>Add New Password</h2>
          
          <form className="form" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.9rem', fontWeight: '600', color: '#4a5568', marginBottom: '0.5rem' }}>Platform</label>
              <input
                type="text"
                placeholder="E.g. Facebook"
                value={platform}
                onChange={(e) => setPlatform(e.target.value)}
                style={{ width: '100%', padding: '1rem', fontSize: '1rem', border: '2px solid #e2e8f0', borderRadius: '12px', outline: 'none', transition: 'all 0.3s ease', boxSizing: 'border-box' }}
                onFocus={(e) => { e.target.style.borderColor = '#667eea'; e.target.style.boxShadow = '0 0 0 3px rgba(102,126,234,0.1)'; }}
                onBlur={(e) => { e.target.style.borderColor = '#e2e8f0'; e.target.style.boxShadow = 'none'; }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.9rem', fontWeight: '600', color: '#4a5568', marginBottom: '0.5rem' }}>Email</label>
              <input
                type="text"
                placeholder="E.g. rohitsaini@gmail.com"
                value={platEmail}
                onChange={(e) => setPlatEmail(e.target.value)}
                style={{ width: '100%', padding: '1rem', fontSize: '1rem', border: '2px solid #e2e8f0', borderRadius: '12px', outline: 'none', transition: 'all 0.3s ease', boxSizing: 'border-box' }}
                onFocus={(e) => { e.target.style.borderColor = '#667eea'; e.target.style.boxShadow = '0 0 0 3px rgba(102,126,234,0.1)'; }}
                onBlur={(e) => { e.target.style.borderColor = '#e2e8f0'; e.target.style.boxShadow = 'none'; }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.9rem', fontWeight: '600', color: '#4a5568', marginBottom: '0.5rem' }}>Password</label>
              <input
                type="password"
                placeholder="Password"
                value={platPass}
                onChange={(e) => setPlatPass(e.target.value)}
                style={{ width: '100%', padding: '1rem', fontSize: '1rem', border: '2px solid #e2e8f0', borderRadius: '12px', outline: 'none', transition: 'all 0.3s ease', boxSizing: 'border-box' }}
                onFocus={(e) => { e.target.style.borderColor = '#667eea'; e.target.style.boxShadow = '0 0 0 3px rgba(102,126,234,0.1)'; }}
                onBlur={(e) => { e.target.style.borderColor = '#e2e8f0'; e.target.style.boxShadow = 'none'; }}
              />
            </div>

            <button 
              onClick={addNewPassword}
              style={{ background: 'linear-gradient(45deg, #667eea, #764ba2)', color: 'white', border: 'none', borderRadius: '12px', padding: '1rem 2rem', fontSize: '1.1rem', fontWeight: '600', cursor: 'pointer', transition: 'all 0.3s ease', boxShadow: '0 4px 16px rgba(102,126,234,0.3)', marginTop: '1rem' }}
              onMouseEnter={(e) => { e.target.style.transform = 'translateY(-1px)'; e.target.style.boxShadow = '0 6px 20px rgba(102,126,234,0.4)'; }}
              onMouseLeave={(e) => { e.target.style.transform = 'translateY(0)'; e.target.style.boxShadow = '0 4px 16px rgba(102,126,234,0.3)'; }}
            >
              Add Password
            </button>
          </form>
        </div>
      </Modal>

      {/* Passwords List */}
      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
        {passwords?.length !== 0 ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))', gap: '1.5rem' }}>
            {passwords
              ?.filter((data) =>
                data.platform.toLowerCase().includes(searchTerm.toLowerCase())
              )
              .map((data) =>
                editingId === data._id ? (
                  <div 
                    key={data._id} 
                    style={{ background: 'rgba(255,255,255,0.95)', backdropFilter: 'blur(20px)', borderRadius: '20px', padding: '1.5rem', border: '1px solid rgba(255,255,255,0.3)', boxShadow: '0 8px 32px rgba(0,0,0,0.1)', transition: 'all 0.3s ease' }}
                  >
                    <div style={{ marginBottom: '1rem' }}>
                      <label style={{ display: 'block', fontSize: '0.9rem', fontWeight: '600', color: '#4a5568', marginBottom: '0.5rem' }}>New Password</label>
                      <input
                        type="password"
                        value={newPass}
                        onChange={(e) => setNewPass(e.target.value)}
                        style={{ width: '100%', padding: '0.75rem', fontSize: '1rem', border: '2px solid #e2e8f0', borderRadius: '8px', outline: 'none', transition: 'all 0.3s ease', boxSizing: 'border-box' }}
                        onFocus={(e) => { e.target.style.borderColor = '#48bb78'; e.target.style.boxShadow = '0 0 0 3px rgba(72,187,120,0.1)'; }}
                        onBlur={(e) => { e.target.style.borderColor = '#e2e8f0'; e.target.style.boxShadow = 'none'; }}
                      />
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <button 
                        onClick={() => handleEditPassword(data._id, data.platform, data.platEmail)}
                        style={{ flex: '1', background: 'linear-gradient(45deg, #48bb78, #38a169)', color: 'white', border: 'none', borderRadius: '8px', padding: '0.75rem', fontSize: '0.9rem', fontWeight: '600', cursor: 'pointer', transition: 'all 0.3s ease' }}
                        onMouseEnter={(e) => { e.target.style.transform = 'translateY(-1px)'; }}
                        onMouseLeave={(e) => { e.target.style.transform = 'translateY(0)'; }}
                      >
                        Save
                      </button>
                      <button 
                        onClick={() => setEditingId(null)}
                        style={{ flex: '1', background: 'linear-gradient(45deg, #f56565, #e53e3e)', color: 'white', border: 'none', borderRadius: '8px', padding: '0.75rem', fontSize: '0.9rem', fontWeight: '600', cursor: 'pointer', transition: 'all 0.3s ease' }}
                        onMouseEnter={(e) => { e.target.style.transform = 'translateY(-1px)'; }}
                        onMouseLeave={(e) => { e.target.style.transform = 'translateY(0)'; }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div 
                    key={data._id} 
                    style={{ background: 'rgba(255,255,255,0.95)', backdropFilter: 'blur(20px)', borderRadius: '20px', padding: '1.5rem', border: '1px solid rgba(255,255,255,0.3)', boxShadow: '0 8px 32px rgba(0,0,0,0.1)', transition: 'all 0.3s ease', position: 'relative', overflow: 'hidden', minHeight: '180px' }}
                    onMouseEnter={(e) => { e.target.style.transform = 'translateY(-4px)'; e.target.style.boxShadow = '0 12px 40px rgba(0,0,0,0.15)'; }}
                    onMouseLeave={(e) => { e.target.style.transform = 'translateY(0)'; e.target.style.boxShadow = '0 8px 32px rgba(0,0,0,0.1)'; }}
                  >
                    <button 
                      onClick={() => { setEditingId(data._id); setNewPass(data.password); }}
                      style={{ position: 'absolute', top: '1rem', right: '1rem', background: 'linear-gradient(45deg, #ed8936, #dd6b20)', color: 'white', border: 'none', borderRadius: '8px', padding: '0.5rem 1rem', fontSize: '0.8rem', fontWeight: '600', cursor: 'pointer', transition: 'all 0.3s ease', zIndex: 10 }}
                      onMouseEnter={(e) => { e.target.style.transform = 'scale(1.05)'; }}
                      onMouseLeave={(e) => { e.target.style.transform = 'scale(1)'; }}
                    >
                      ✏️ Edit
                    </button>
                    
                    {/* Custom Password Display */}
                    <div style={{ paddingRight: '6rem' }}>
                      {/* Platform Name */}
                      <div style={{ marginBottom: '1rem' }}>
                        <h3 style={{ fontSize: '1.4rem', fontWeight: '700', color: '#2d3748', margin: '0', textTransform: 'capitalize' }}>
                          {data.platform}
                        </h3>
                      </div>
                      
                      {/* Email */}
                      <div style={{ marginBottom: '1rem' }}>
                        <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '600', color: '#718096', marginBottom: '0.25rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Email</label>
                        <div style={{ background: 'rgba(102,126,234,0.1)', padding: '0.75rem', borderRadius: '8px', border: '1px solid rgba(102,126,234,0.2)' }}>
                          <span style={{ fontSize: '0.95rem', color: '#4a5568', fontFamily: 'monospace' }}>{data.platEmail}</span>
                        </div>
                      </div>
                      
                      {/* Password */}
                      <div>
                        <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '600', color: '#718096', marginBottom: '0.25rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Password</label>
                        <div style={{ background: 'rgba(72,187,120,0.1)', padding: '0.75rem', borderRadius: '8px', border: '1px solid rgba(72,187,120,0.2)' }}>
                          <Password
                            key={data._id}
                            id={data._id}
                            name={data.platform}
                            password={data.password}
                            email={data.platEmail}
                            iv={data.iv}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                )
              )
            }
          </div>
        ) : (
          <div style={{ textAlign: 'center', background: 'rgba(255,255,255,0.95)', backdropFilter: 'blur(20px)', borderRadius: '24px', padding: '4rem 2rem', border: '1px solid rgba(255,255,255,0.3)', boxShadow: '0 8px 32px rgba(0,0,0,0.1)' }}>
            <div style={{ fontSize: '4rem', marginBottom: '1rem' }}>🔐</div>
            <p style={{ fontSize: '1.2rem', color: '#4a5568', marginBottom: '2rem', fontWeight: '500' }}>You haven't added any passwords yet</p>
            <button 
              onClick={() => setOpen(true)}
              style={{ background: 'linear-gradient(45deg, #667eea, #764ba2)', color: 'white', border: 'none', borderRadius: '16px', padding: '1rem 2rem', fontSize: '1.1rem', fontWeight: '600', cursor: 'pointer', transition: 'all 0.3s ease', boxShadow: '0 4px 16px rgba(102,126,234,0.3)' }}
              onMouseEnter={(e) => { e.target.style.transform = 'translateY(-2px)'; e.target.style.boxShadow = '0 8px 24px rgba(102,126,234,0.4)'; }}
              onMouseLeave={(e) => { e.target.style.transform = 'translateY(0)'; e.target.style.boxShadow = '0 4px 16px rgba(102,126,234,0.3)'; }}
            >
              🚀 Add Your First Password
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default Passwords;
